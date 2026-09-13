import { describe, expect, test } from "bun:test";
import { fuzzyMatches, fuzzyScore } from "../src/lib/fuzzy";

const SONG = "Level1/Level2/Level3/Level4/Level5/Deep Song.mp3";

describe("fuzzyScore", () => {
	test("an empty query matches everything", () => {
		expect(fuzzyScore("", "anything")).toBe(0);
		expect(fuzzyScore("   ", "anything")).toBe(0);
	});

	test("matches an exact substring", () => {
		expect(fuzzyScore("deep", "Deep Song.mp3")).not.toBeNull();
	});

	test("ignores case in both directions", () => {
		expect(fuzzyScore("DEEP", "deep song")).not.toBeNull();
		expect(fuzzyScore("deep", "DEEP SONG")).not.toBeNull();
	});

	test("matches characters that are not next to each other", () => {
		expect(fuzzyScore("dpsng", "Deep Song.mp3")).not.toBeNull();
		expect(fuzzyScore("lvl5", "Level5")).not.toBeNull();
	});

	test("every term has to hit, in any order", () => {
		expect(fuzzyScore("deep level5", SONG)).not.toBeNull();
		expect(fuzzyScore("level5 deep", SONG)).not.toBeNull();
		expect(fuzzyScore("deep nothere", SONG)).toBeNull();
	});

	test("rejects a character the target does not hold", () => {
		expect(fuzzyScore("deepz", "Deep Song.mp3")).toBeNull();
	});

	test("rejects characters that appear out of order", () => {
		expect(fuzzyScore("gnos", "Song")).toBeNull();
	});

	test("ranks a contiguous match above a scattered one", () => {
		const contiguous = fuzzyScore("song", "Song") ?? -1;
		const scattered = fuzzyScore("song", "Sardine of naked gravy") ?? -1;
		expect(contiguous).toBeGreaterThan(scattered);
	});

	test("ranks a match at a word start above one inside a word", () => {
		const atStart = fuzzyScore("song", "Deep Song") ?? -1;
		const inside = fuzzyScore("song", "Besonglike") ?? -1;
		expect(atStart).toBeGreaterThan(inside);
	});

	test("ranks the tighter target first for the same characters", () => {
		const tight = fuzzyScore("deep", "Deep") ?? -1;
		const loose = fuzzyScore("deep", "Deep inside a much longer name") ?? -1;
		expect(tight).toBeGreaterThan(loose);
	});
});

describe("fuzzyMatches", () => {
	test("an empty query keeps everything", () => {
		expect(fuzzyMatches("", "a", "b")).toBe(true);
	});

	test("matches the name or the full path", () => {
		expect(fuzzyMatches("level3", "Deep Song.mp3", SONG)).toBe(true);
		expect(fuzzyMatches("deep", "Deep Song.mp3", SONG)).toBe(true);
		expect(fuzzyMatches("nothere", "Deep Song.mp3", SONG)).toBe(false);
	});

	test("finds a folder by a piece of its name", () => {
		expect(fuzzyMatches("lv2", "Level2", "Level1/Level2")).toBe(true);
	});
});
