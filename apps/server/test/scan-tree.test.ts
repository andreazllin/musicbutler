import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TreeEntry } from "@musicbutler/shared";
import { scanTree } from "../src/fs/library.ts";
import { makeTempLibrary, type TempLibrary } from "./helpers.ts";

let lib: TempLibrary;
beforeEach(() => {
	lib = makeTempLibrary();
});
afterEach(() => lib.cleanup());

/** Every path in the tree, depth first, so a whole shape can be asserted at once. */
function paths(nodes: TreeEntry[]): string[] {
	return nodes.flatMap((n) => (n.kind === "dir" ? [n.path, ...paths(n.children)] : [n.path]));
}

function find(nodes: TreeEntry[], path: string): TreeEntry | undefined {
	for (const n of nodes) {
		if (n.path === path) return n;
		if (n.kind === "dir") {
			const hit = find(n.children, path);
			if (hit) return hit;
		}
	}
	return undefined;
}

describe("scanTree", () => {
	test("returns the whole library in one call", async () => {
		const tree = await scanTree();
		expect(paths(tree.children)).toEqual([
			"Artist One",
			"Artist One/Album A",
			"Artist One/Album A/01 First Song.mp3",
			"Artist One/Album A/02 Second Song.flac",
			"Artist One/Album A/10 Tenth Song.ogg",
			"Artist Two",
			"Artist Two/Single.m4a",
		]);
		expect(tree.truncated).toBe(false);
		expect(tree.count).toBe(7);
	});

	test("keeps directories before files and sorts each naturally", async () => {
		mkdirSync(join(lib.dir, "Artist One/Album A/Zed Sub"));
		const tree = await scanTree();
		const album = find(tree.children, "Artist One/Album A");
		if (album?.kind !== "dir") throw new Error("expected a directory");
		expect(album.children.map((c) => c.name)).toEqual([
			"Zed Sub",
			"01 First Song.mp3",
			"02 Second Song.flac",
			"10 Tenth Song.ogg",
		]);
	});

	test("marks the song whose .lrc sits beside it", async () => {
		const tree = await scanTree();
		const withLrc = find(tree.children, "Artist One/Album A/02 Second Song.flac");
		const without = find(tree.children, "Artist One/Album A/01 First Song.mp3");
		expect(withLrc?.kind === "audio" && withLrc.hasLrc).toBe(true);
		expect(without?.kind === "audio" && without.hasLrc).toBe(false);
	});

	test("leaves out hidden directories, @eaDir and non-audio files", async () => {
		const all = paths((await scanTree()).children);
		expect(all.some((p) => p.includes(".hidden-dir"))).toBe(false);
		expect(all.some((p) => p.includes("@eaDir"))).toBe(false);
		expect(all.some((p) => p.endsWith("cover.jpg"))).toBe(false);
		expect(all.some((p) => p.endsWith(".lrc"))).toBe(false);
	});

	test("reaches a deeply nested song, with no assumption about depth", async () => {
		const deep = join(lib.dir, "A/B/C/D/E/F");
		mkdirSync(deep, { recursive: true });
		writeFileSync(join(deep, "Deep.mp3"), "");
		const all = paths((await scanTree()).children);
		expect(all).toContain("A/B/C/D/E/F/Deep.mp3");
	});

	test("a symlink pointing back at an ancestor does not loop", async () => {
		symlinkSync(join(lib.dir, "Artist One"), join(lib.dir, "Artist One/Album A/loop"));
		const tree = await scanTree();
		// It resolves inside the library, so it is offered once and then not
		// walked again, which is what keeps the recursion finite.
		expect(tree.truncated).toBe(false);
		expect(paths(tree.children).filter((p) => p.endsWith("01 First Song.mp3"))).toHaveLength(1);
	});

	test("a symlink escaping the library is left out", async () => {
		symlinkSync("/tmp", join(lib.dir, "Artist Two/escape"));
		const all = paths((await scanTree()).children);
		expect(all.some((p) => p.endsWith("escape"))).toBe(false);
	});
});
