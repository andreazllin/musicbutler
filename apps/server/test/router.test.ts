import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { createCaller } from "../src/routers/index.ts";
import { makeTempLibrary, SONG_FLAC, SONG_MP3, type TempLibrary } from "./helpers.ts";

let lib: TempLibrary;
const caller = createCaller({});

beforeAll(() => {
	lib = makeTempLibrary();
});
afterAll(() => lib.cleanup());

async function codeOf(p: Promise<unknown>): Promise<string> {
	try {
		await p;
	} catch (err) {
		if (err instanceof TRPCError) return err.code;
		throw err;
	}
	throw new Error("expected the procedure to throw");
}

describe("library.list", () => {
	test("lists the root", async () => {
		const res = await caller.library.list({ path: "" });
		expect(res.parent).toBeNull();
		expect(res.entries.map((e) => e.name)).toEqual(["Artist One", "Artist Two"]);
	});
	test("hides .lrc and cover.jpg, sets hasLrc, natural sort", async () => {
		const res = await caller.library.list({ path: "Artist One/Album A" });
		expect(res.parent).toBe("Artist One");
		expect(res.entries.map((e) => e.name)).toEqual([
			"01 First Song.mp3",
			"02 Second Song.flac",
			"10 Tenth Song.ogg",
		]);
		expect(res.entries.map((e) => (e.kind === "audio" ? e.hasLrc : null))).toEqual([
			false,
			true,
			false,
		]);
	});
	test("maps errors: NOT_FOUND, FORBIDDEN (without the path)", async () => {
		expect(await codeOf(caller.library.list({ path: "Does Not Exist" }))).toBe("NOT_FOUND");
		let caught: TRPCError | undefined;
		try {
			await caller.library.list({ path: "../secret-place" });
		} catch (err) {
			caught = err as TRPCError;
		}
		expect(caught?.code).toBe("FORBIDDEN");
		expect(caught?.message).not.toContain("secret-place");
	});
});

describe("lrc.get", () => {
	test("returns the existing file", async () => {
		const res = await caller.lrc.get({ audioPath: SONG_FLAC });
		expect(res.exists).toBe(true);
		expect(res.lrcPath).toBe("Artist One/Album A/02 Second Song.lrc");
		expect(res.content).toContain("la la la");
		expect(typeof res.mtimeMs).toBe("number");
	});
	test("returns exists:false and content '' when absent", async () => {
		const res = await caller.lrc.get({ audioPath: SONG_MP3 });
		expect(res).toMatchObject({ exists: false, content: "", mtimeMs: null });
	});
	test("rejects a non-audio path with BAD_REQUEST", async () => {
		expect(await codeOf(caller.lrc.get({ audioPath: "Artist One/Album A/cover.jpg" }))).toBe(
			"BAD_REQUEST",
		);
	});
	test("missing audio is NOT_FOUND", async () => {
		expect(await codeOf(caller.lrc.get({ audioPath: "Artist Two/nope.mp3" }))).toBe("NOT_FOUND");
	});
});

describe("lrc.save (docs/PLAN.md §5.2, §6.2)", () => {
	const lrcAbs = () => join(lib.dir, "Artist One/Album A/01 First Song.lrc");

	test("whitespace-only with no file is a noop", async () => {
		const res = await caller.lrc.save({
			audioPath: SONG_MP3,
			content: "  \n\t",
			expectedMtimeMs: null,
		});
		expect(res).toEqual({ action: "noop", mtimeMs: null });
		expect(existsSync(lrcAbs())).toBe(false);
	});

	test("write creates the file (0644, LF, one trailing newline)", async () => {
		const res = await caller.lrc.save({
			audioPath: SONG_MP3,
			content: "[00:01.00]one\r\n[00:02.00]two",
			expectedMtimeMs: null,
		});
		expect(res.action).toBe("written");
		expect(res.mtimeMs).toBe(statSync(lrcAbs()).mtimeMs);
		expect(statSync(lrcAbs()).mode & 0o777).toBe(0o644);
		expect(readFileSync(lrcAbs(), "utf8")).toBe("[00:01.00]one\n[00:02.00]two\n");
	});

	test("expectedMtimeMs null while a file exists is a CONFLICT", async () => {
		expect(
			await codeOf(caller.lrc.save({ audioPath: SONG_MP3, content: "x", expectedMtimeMs: null })),
		).toBe("CONFLICT");
	});

	test("edit with the right mtime updates; a stale mtime is a CONFLICT", async () => {
		const before = await caller.lrc.get({ audioPath: SONG_MP3 });
		const res = await caller.lrc.save({
			audioPath: SONG_MP3,
			content: "[00:03.00]three\n",
			expectedMtimeMs: before.mtimeMs,
		});
		expect(res.action).toBe("written");
		expect(readFileSync(lrcAbs(), "utf8")).toBe("[00:03.00]three\n");

		// Simulate an external change.
		const t = new Date(Date.now() + 5000);
		utimesSync(lrcAbs(), t, t);
		expect(
			await codeOf(
				caller.lrc.save({ audioPath: SONG_MP3, content: "y", expectedMtimeMs: before.mtimeMs }),
			),
		).toBe("CONFLICT");
		expect(readFileSync(lrcAbs(), "utf8")).toBe("[00:03.00]three\n");
	});

	test("whitespace-only with an existing file deletes it", async () => {
		const current = await caller.lrc.get({ audioPath: SONG_MP3 });
		const res = await caller.lrc.save({
			audioPath: SONG_MP3,
			content: "\n\n  ",
			expectedMtimeMs: current.mtimeMs,
		});
		expect(res).toEqual({ action: "deleted", mtimeMs: null });
		expect(existsSync(lrcAbs())).toBe(false);
	});

	test("no *.tmp-* leftovers, audio untouched", () => {
		const names = readdirSync(join(lib.dir, "Artist One/Album A"));
		expect(names.filter((n) => n.includes(".tmp-"))).toEqual([]);
		expect(names).toContain("01 First Song.mp3");
	});

	test("rejects a non-audio path and traversal", async () => {
		expect(
			await codeOf(
				caller.lrc.save({
					audioPath: "Artist One/Album A/cover.jpg",
					content: "x",
					expectedMtimeMs: null,
				}),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(caller.lrc.save({ audioPath: "../x.mp3", content: "x", expectedMtimeMs: null })),
		).toBe("FORBIDDEN");
	});
});

describe("sync.*", () => {
	test("languages reports both languages as unavailable when the model cache is empty", async () => {
		const res = await caller.sync.languages();
		expect(res).toEqual({
			langs: [
				{ code: "en-US", label: "English", available: false },
				{ code: "it-IT", label: "Italiano", available: false },
			],
		});
	});
	test("start is PRECONDITION_FAILED for a language without an installed model", async () => {
		expect(
			await codeOf(caller.sync.start({ audioPath: SONG_MP3, lyrics: "la la", lang: "en-US" })),
		).toBe("PRECONDITION_FAILED");
	});
	test("cancel of an unknown job reports false; progress of an unknown job is NOT_FOUND", async () => {
		expect(await caller.sync.cancel({ jobId: "x" })).toEqual({ cancelled: false });
		const iter = await caller.sync.progress({ jobId: "x" });
		let code: string | null = null;
		try {
			for await (const _ of iter) break;
		} catch (err) {
			if (err instanceof TRPCError) code = err.code;
		}
		expect(code).toBe("NOT_FOUND");
	});
});
