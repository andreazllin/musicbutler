import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { normalizeLibraryPath, resolveLibraryPath } from "../src/fs/paths.ts";
import { makeTempLibrary, SONG_FLAC, type TempLibrary } from "./helpers.ts";

let lib: TempLibrary;

beforeAll(() => {
	lib = makeTempLibrary();
	symlinkSync("/etc", join(lib.dir, "escape-dir"));
	symlinkSync("/etc/hosts", join(lib.dir, "Artist Two", "escape.mp3"));
});
afterAll(() => lib.cleanup());

async function expectForbidden(input: string): Promise<void> {
	let caught: unknown;
	try {
		await resolveLibraryPath(input);
	} catch (err) {
		caught = err;
	}
	expect(caught).toBeInstanceOf(TRPCError);
	const e = caught as TRPCError;
	expect(e.code).toBe("FORBIDDEN");
	// The message must never echo the input (docs/PLAN.md §5.3).
	for (const piece of input.split(/[/\\\0]/).filter((p) => p.length > 1)) {
		expect(e.message).not.toContain(piece);
	}
	expect(e.message).not.toContain(input);
}

describe("resolveLibraryPath (docs/PLAN.md §5.3)", () => {
	test("rejects a `..` segment", async () => {
		await expectForbidden("../x.mp3");
		await expectForbidden("Artist One/../../x.mp3");
		await expectForbidden("Artist One/..");
	});
	test("rejects an absolute path", async () => {
		await expectForbidden("/etc/passwd");
	});
	test("rejects a backslash", async () => {
		await expectForbidden("a\\b.mp3");
	});
	test("rejects a NUL byte", async () => {
		await expectForbidden("a\0b.mp3");
	});
	test("rejects a symlinked directory that points outside the library", async () => {
		await expectForbidden("escape-dir");
		await expectForbidden("escape-dir/hosts");
	});
	test("rejects a symlinked file that points outside the library", async () => {
		await expectForbidden("Artist Two/escape.mp3");
	});
	test("resolves the root and existing files inside the library", async () => {
		expect(await resolveLibraryPath("")).toBe(lib.dir);
		expect(await resolveLibraryPath(".")).toBe(lib.dir);
		expect(await resolveLibraryPath(SONG_FLAC)).toBe(join(lib.dir, SONG_FLAC));
		expect(await resolveLibraryPath("Artist One/./Album A/")).toBe(
			join(lib.dir, "Artist One/Album A"),
		);
	});
	test("resolves a not-yet-existing file through its real parent", async () => {
		expect(await resolveLibraryPath("Artist Two/new.lrc")).toBe(
			join(lib.dir, "Artist Two/new.lrc"),
		);
	});
	test("a missing parent surfaces as ENOENT (mapped to NOT_FOUND by the router)", async () => {
		await expect(resolveLibraryPath("Nope/new.lrc")).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("normalizeLibraryPath", () => {
	test("canonicalizes separators and the root", () => {
		expect(normalizeLibraryPath("")).toBe("");
		expect(normalizeLibraryPath(".")).toBe("");
		expect(normalizeLibraryPath("./")).toBe("");
		expect(normalizeLibraryPath("A//B/")).toBe("A/B");
		expect(normalizeLibraryPath("A/./B")).toBe("A/B");
	});
	test("rejects escapes without echoing the input", () => {
		expect(() => normalizeLibraryPath("..")).toThrow(TRPCError);
		expect(() => normalizeLibraryPath("A/../..")).toThrow(TRPCError);
		expect(() => normalizeLibraryPath("/abs")).toThrow(TRPCError);
		try {
			normalizeLibraryPath("secret-dir/../../etc");
		} catch (err) {
			expect((err as Error).message).not.toContain("secret-dir");
		}
	});
});
