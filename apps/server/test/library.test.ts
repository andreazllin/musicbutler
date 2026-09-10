import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import {
	canonicalizeLrcContent,
	deleteLrc,
	listDir,
	readLrc,
	unlinkLrcGuarded,
	writeLrcAtomic,
} from "../src/fs/library.ts";
import {
	makeTempLibrary,
	SONG_FLAC,
	SONG_FLAC_LRC,
	SONG_M4A,
	SONG_MP3,
	SONG_OGG,
	type TempLibrary,
} from "./helpers.ts";

let lib: TempLibrary;

beforeAll(() => {
	lib = makeTempLibrary();
	// Extra noise the tree must hide (docs/PLAN.md §5.5).
	writeFileSync(join(lib.dir, "Artist One/Album A/.DS_Store"), "x");
	writeFileSync(join(lib.dir, "Artist One/Album A/notes.txt"), "x");
	writeFileSync(join(lib.dir, "Artist One/Album A/orphan.lrc"), "[00:01.00]orphan\n");
	mkdirSync(join(lib.dir, "Artist One/Album A/@eaDir"));
	// Upper-case extension must still count as audio.
	writeFileSync(join(lib.dir, "Artist Two/Loud.MP3"), "not really audio");
});
afterAll(() => lib.cleanup());

describe("listDir (docs/PLAN.md §5.5, §6.2)", () => {
	test("root: dirs only, parent null, childCount counts visible entries", async () => {
		const res = await listDir("");
		expect(res.path).toBe("");
		expect(res.parent).toBeNull();
		expect(res.entries.map((e) => e.name)).toEqual(["Artist One", "Artist Two"]);
		const artistOne = res.entries[0];
		const artistTwo = res.entries[1];
		expect(artistOne?.kind).toBe("dir");
		if (artistOne?.kind === "dir") expect(artistOne.childCount).toBe(1); // Album A
		if (artistTwo?.kind === "dir") expect(artistTwo.childCount).toBe(2); // Single.m4a + Loud.MP3
	});

	test("album: hides .lrc, dotfiles, @eaDir and non-audio; natural sort; hasLrc badge", async () => {
		const res = await listDir("Artist One/Album A/");
		expect(res.path).toBe("Artist One/Album A");
		expect(res.parent).toBe("Artist One");
		expect(res.entries.map((e) => e.name)).toEqual([
			"01 First Song.mp3",
			"02 Second Song.flac",
			"10 Tenth Song.ogg",
		]);
		const byName = new Map(res.entries.map((e) => [e.name, e]));
		const flac = byName.get("02 Second Song.flac");
		const mp3 = byName.get("01 First Song.mp3");
		expect(flac?.kind).toBe("audio");
		if (flac?.kind === "audio") {
			expect(flac.hasLrc).toBe(true);
			expect(flac.ext).toBe(".flac");
			expect(flac.path).toBe(SONG_FLAC);
			expect(flac.sizeBytes).toBe(statSync(join(lib.dir, SONG_FLAC)).size);
			expect(flac.mtimeMs).toBeGreaterThan(0);
		}
		if (mp3?.kind === "audio") expect(mp3.hasLrc).toBe(false);
	});

	test("dirs come before audio and the extension match is case-insensitive", async () => {
		mkdirSync(join(lib.dir, "Artist Two/zz Live"));
		const res = await listDir("Artist Two");
		expect(res.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
			"dir:zz Live",
			"audio:Loud.MP3",
			"audio:Single.m4a",
		]);
		const loud = res.entries.find((e) => e.name === "Loud.MP3");
		if (loud?.kind === "audio") expect(loud.ext).toBe(".mp3");
	});

	test("natural sort is numeric-aware and case-insensitive", async () => {
		mkdirSync(join(lib.dir, "Sort"));
		for (const n of ["b 10", "a 2", "B 1", "A 10", "a 1"]) mkdirSync(join(lib.dir, "Sort", n));
		const res = await listDir("Sort");
		expect(res.entries.map((e) => e.name)).toEqual(["a 1", "a 2", "A 10", "B 1", "b 10"]);
	});

	test("hidden top-level dirs never appear", async () => {
		const res = await listDir("");
		expect(res.entries.some((e) => e.name.startsWith(".") || e.name === "@eaDir")).toBe(false);
	});

	test("listing a missing directory throws ENOENT", async () => {
		await expect(listDir("Nope")).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("readLrc", () => {
	test("returns the content and mtime when the .lrc exists", async () => {
		const res = await readLrc(SONG_FLAC);
		expect(res.exists).toBe(true);
		expect(res.lrcPath).toBe(SONG_FLAC_LRC);
		expect(res.content).toBe("[00:00.50]la la la\n[00:01.50]line two\n");
		expect(res.mtimeMs).toBe(statSync(join(lib.dir, SONG_FLAC_LRC)).mtimeMs);
	});
	test("returns exists:false, empty content and null mtime otherwise", async () => {
		const res = await readLrc(SONG_MP3);
		expect(res).toEqual({
			lrcPath: "Artist One/Album A/01 First Song.lrc",
			exists: false,
			content: "",
			mtimeMs: null,
		});
	});
	test("a missing audio file throws ENOENT; a non-audio path is BAD_REQUEST", async () => {
		await expect(readLrc("Artist Two/missing.mp3")).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readLrc("Artist One/Album A/cover.jpg")).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});

describe("writeLrcAtomic (docs/PLAN.md §5.2)", () => {
	test("creates the file with mode 0644, LF endings and one trailing newline", async () => {
		const mtime = await writeLrcAtomic(SONG_OGG, "﻿[00:01.00]one\r\n[00:02.00]two\r\n\r\n");
		const abs = join(lib.dir, "Artist One/Album A/10 Tenth Song.lrc");
		const s = statSync(abs);
		expect(s.mode & 0o777).toBe(0o644);
		expect(s.mtimeMs).toBe(mtime);
		expect(readFileSync(abs, "utf8")).toBe("[00:01.00]one\n[00:02.00]two\n");
		const leftovers = readdirSync(join(lib.dir, "Artist One/Album A")).filter((n) =>
			n.includes(".tmp-"),
		);
		expect(leftovers).toEqual([]);
	});
	test("overwrites an existing file", async () => {
		await writeLrcAtomic(SONG_OGG, "[00:03.00]three");
		const abs = join(lib.dir, "Artist One/Album A/10 Tenth Song.lrc");
		expect(readFileSync(abs, "utf8")).toBe("[00:03.00]three\n");
	});
	test("canonicalizeLrcContent", () => {
		expect(canonicalizeLrcContent("a\r\nb")).toBe("a\nb\n");
		expect(canonicalizeLrcContent("a\n\n\n")).toBe("a\n");
		expect(canonicalizeLrcContent("a\rb")).toBe("a\nb\n");
	});
});

describe("deletion guard (docs/PLAN.md §5.4)", () => {
	test("refuses to delete a .flac", async () => {
		await expect(unlinkLrcGuarded(SONG_FLAC)).rejects.toThrow(/deletion guard/i);
		expect(existsSync(join(lib.dir, SONG_FLAC))).toBe(true);
	});
	test("refuses to delete a .jpg", async () => {
		await expect(unlinkLrcGuarded("Artist One/Album A/cover.jpg")).rejects.toThrow(
			/deletion guard/i,
		);
		expect(existsSync(join(lib.dir, "Artist One/Album A/cover.jpg"))).toBe(true);
	});
	test("refuses to delete an .lrc that has no matching audio file", async () => {
		await expect(unlinkLrcGuarded("Artist One/Album A/orphan.lrc")).rejects.toThrow(
			/deletion guard/i,
		);
		expect(existsSync(join(lib.dir, "Artist One/Album A/orphan.lrc"))).toBe(true);
	});
	test("the guard never throws a TRPCError for a bug (it is a 500, not a user error)", async () => {
		let caught: unknown;
		try {
			await unlinkLrcGuarded(SONG_FLAC);
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(Error);
		expect(caught).not.toBeInstanceOf(TRPCError);
	});
	test("deletes the .lrc of a real audio file", async () => {
		await writeLrcAtomic(SONG_M4A, "[00:01.00]x");
		const abs = join(lib.dir, "Artist Two/Single.lrc");
		expect(existsSync(abs)).toBe(true);
		await deleteLrc(SONG_M4A);
		expect(existsSync(abs)).toBe(false);
	});
});
