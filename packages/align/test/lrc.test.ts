/** §5.10: exact LRC string for a two-line fixture, both lineTagMode values, spacing option, JSON/CSV. */
import { describe, expect, test } from "bun:test";
import { secondsToLrc, wordsToCsv, wordsToJson, wordsToLrc } from "../src/lrc/format.ts";
import type { Word } from "../src/types.ts";

const LINES = ["Line one here", "", "Line two"];
const WORDS: Word[] = [
	{ text: "Line", start: 1.234, end: 1.5, score: 0.9, line: 0 },
	{ text: "one", start: 1.6, end: 1.9, score: 0.9, line: 0 },
	{ text: "here", start: 2.0, end: 2.4, score: 0.9, line: 0 },
	{ text: "Line", start: 61.005, end: 61.3, score: 0.9, line: 2 },
	{ text: "two", start: 61.5, end: 62.0, score: 0.9, line: 2 },
];

describe("secondsToLrc", () => {
	test("floors hundredths and clamps at 0", () => {
		expect(secondsToLrc(0, "line")).toBe("[00:00.00]");
		expect(secondsToLrc(1.239, "word")).toBe("<00:01.23>");
		expect(secondsToLrc(61.005, "line")).toBe("[01:01.00]");
		expect(secondsToLrc(-3, "line")).toBe("[00:00.00]");
		expect(secondsToLrc(Number.NaN, "word")).toBe("<00:00.00>");
		expect(secondsToLrc(600, "line")).toBe("[10:00.00]");
		// float noise: 1.1 * 100 = 110.00000000000001, 0.29 * 100 = 28.999999999999996
		expect(secondsToLrc(0.29, "word")).toBe("<00:00.29>");
	});
});

describe("wordsToLrc", () => {
	test("two-line fixture, default first-word mode, no spacing", () => {
		expect(wordsToLrc(WORDS, LINES)).toBe(
			"[00:01.23]<00:01.23>Line <00:01.60>one <00:02.00>here\n[01:01.00]<01:01.00>Line <01:01.50>two\n",
		);
	});
	test("prev-end mode uses the end of the previous word (00:00.00 for the first line)", () => {
		expect(wordsToLrc(WORDS, LINES, { lineTagMode: "prev-end" })).toBe(
			"[00:00.00]<00:01.23>Line <00:01.60>one <00:02.00>here\n[00:02.40]<01:01.00>Line <01:01.50>two\n",
		);
	});
	test("original spacing writes <tag> word", () => {
		expect(wordsToLrc(WORDS, LINES, { spacing: "original" })).toBe(
			"[00:01.23] <00:01.23> Line <00:01.60> one <00:02.00> here\n[01:01.00] <01:01.00> Line <01:01.50> two\n",
		);
	});
	test("headers", () => {
		const out = wordsToLrc(WORDS.slice(0, 3), LINES, {
			headers: { ti: "T", ar: "A", length: 125 },
		});
		expect(out.startsWith("[ti:T]\n[ar:A]\n[re:musicbutler]\n[length:02:05]\n[00:01.23]")).toBe(
			true,
		);
	});
	test("a line whose only word is unalignable gets the inherited time", () => {
		const words: Word[] = [
			{ text: "la", start: 1, end: 2, score: 1, line: 0 },
			{ text: "...", start: 2, end: 2, score: 0, line: 1 },
		];
		expect(wordsToLrc(words, ["la", "...", ""])).toBe(
			"[00:01.00]<00:01.00>la\n[00:02.00]<00:02.00>...\n",
		);
	});
	test("no words gives an empty document", () => {
		expect(wordsToLrc([], ["", ""])).toBe("\n");
	});
});

describe("wordsToJson / wordsToCsv", () => {
	test("json round-trips", () => {
		expect(JSON.parse(wordsToJson(WORDS))).toEqual(WORDS);
	});
	test("csv has label,start,end and quotes commas", () => {
		const csv = wordsToCsv([
			{ text: 'he,"llo', start: 0.5, end: 1, score: 1, line: 0 },
			{ text: "b", start: 1, end: 1.25, score: 1, line: 0 },
		]);
		expect(csv).toBe('label,start,end\n"he,""llo",0.500,1.000\nb,1.000,1.250\n');
	});
});
