import { describe, expect, test } from "bun:test";
import type { LibraryTree, TreeEntry } from "@musicbutler/shared";
import {
	directoryPaths,
	filterNodes,
	toNodes,
	withHasLrc,
} from "../src/features/lyrics-sync/helpers/tree";

const dir = (name: string, path: string, children: TreeEntry[]): TreeEntry => ({
	kind: "dir",
	name,
	path,
	children,
});
const song = (name: string, path: string, hasLrc = false): TreeEntry => ({
	kind: "audio",
	name,
	path,
	ext: ".mp3",
	hasLrc,
});

const LIBRARY: TreeEntry[] = [
	dir("Level1", "Level1", [
		dir("Level2", "Level1/Level2", [
			dir("Level3", "Level1/Level2/Level3", [
				song("Deep Song.mp3", "Level1/Level2/Level3/Deep Song.mp3", true),
			]),
			dir("Sideways", "Level1/Level2/Sideways", [
				song("Mid Song.mp3", "Level1/Level2/Sideways/Mid Song.mp3"),
			]),
		]),
	]),
	dir("Empty", "Empty", []),
];

const values = (nodes: ReturnType<typeof toNodes>): string[] =>
	nodes.flatMap((n) => [n.value, ...(n.children ? values(n.children) : [])]);

describe("toNodes", () => {
	test("keeps the whole shape, at any depth", () => {
		expect(values(toNodes(LIBRARY))).toEqual([
			"Level1",
			"Level1/Level2",
			"Level1/Level2/Level3",
			"Level1/Level2/Level3/Deep Song.mp3",
			"Level1/Level2/Sideways",
			"Level1/Level2/Sideways/Mid Song.mp3",
			"Empty",
		]);
	});
});

describe("directoryPaths", () => {
	test("collects every folder and no song", () => {
		expect([...directoryPaths(LIBRARY)].sort()).toEqual([
			"Empty",
			"Level1",
			"Level1/Level2",
			"Level1/Level2/Level3",
			"Level1/Level2/Sideways",
		]);
	});
});

describe("filterNodes", () => {
	const all = toNodes(LIBRARY);

	test("an empty query returns the tree untouched", () => {
		const result = filterNodes(all, "  ");
		expect(result.nodes).toBe(all);
		expect(result.expand).toEqual([]);
	});

	test("finds a song nested several levels down", () => {
		expect(values(filterNodes(all, "deep").nodes)).toEqual([
			"Level1",
			"Level1/Level2",
			"Level1/Level2/Level3",
			"Level1/Level2/Level3/Deep Song.mp3",
		]);
	});

	test("finds a folder and keeps everything inside it", () => {
		expect(values(filterNodes(all, "sideways").nodes)).toEqual([
			"Level1",
			"Level1/Level2",
			"Level1/Level2/Sideways",
			"Level1/Level2/Sideways/Mid Song.mp3",
		]);
	});

	test("matches fuzzily, with no exact spelling needed", () => {
		expect(values(filterNodes(all, "dpsng").nodes)).toContain("Level1/Level2/Level3/Deep Song.mp3");
		expect(values(filterNodes(all, "sdwys").nodes)).toContain("Level1/Level2/Sideways");
	});

	test("matches on the path, so folder and song terms combine", () => {
		expect(values(filterNodes(all, "level3 deep").nodes)).toContain(
			"Level1/Level2/Level3/Deep Song.mp3",
		);
	});

	test("reports the folders that have to open for the matches to show", () => {
		const { expand } = filterNodes(all, "deep");
		expect(expand).toContain("Level1");
		expect(expand).toContain("Level1/Level2");
		expect(expand).toContain("Level1/Level2/Level3");
		expect(expand).not.toContain("Level1/Level2/Sideways");
	});

	test("returns nothing when the query matches nothing", () => {
		expect(filterNodes(all, "zzzzz").nodes).toEqual([]);
	});

	test("stops at the cap and says so", () => {
		const capped = filterNodes(all, "s", 2);
		const uncapped = filterNodes(all, "s", 100);
		expect(capped.truncated).toBe(true);
		expect(uncapped.truncated).toBe(false);
		expect(values(capped.nodes).length).toBeLessThan(values(uncapped.nodes).length);
	});

	test("does not claim to be cut short when everything fits", () => {
		expect(filterNodes(all, "deep").truncated).toBe(false);
		expect(filterNodes(all, "").truncated).toBe(false);
	});
});

describe("withHasLrc", () => {
	const tree: LibraryTree = { children: LIBRARY, count: 7, truncated: false };

	test("sets the flag on the one song", () => {
		const next = withHasLrc(tree, "Level1/Level2/Sideways/Mid Song.mp3", true);
		const found = values(toNodes(next.children));
		expect(found).toHaveLength(7);
		const sideways = next.children[0];
		if (sideways?.kind !== "dir") throw new Error("expected a directory");
		const level2 = sideways.children[0];
		if (level2?.kind !== "dir") throw new Error("expected a directory");
		const folder = level2.children[1];
		if (folder?.kind !== "dir") throw new Error("expected a directory");
		const mid = folder.children[0];
		expect(mid?.kind === "audio" && mid.hasLrc).toBe(true);
	});

	test("clears the flag too", () => {
		const next = withHasLrc(tree, "Level1/Level2/Level3/Deep Song.mp3", false);
		expect(JSON.stringify(next)).toContain('"hasLrc":false');
	});

	test("returns the same object when nothing changes", () => {
		expect(withHasLrc(tree, "Level1/Level2/Level3/Deep Song.mp3", true)).toBe(tree);
		expect(withHasLrc(tree, "nowhere/at/all.mp3", true)).toBe(tree);
	});

	test("leaves the branches it did not touch identical", () => {
		const next = withHasLrc(tree, "Level1/Level2/Sideways/Mid Song.mp3", true);
		expect(next.children[1]).toBe(tree.children[1]);
	});
});
