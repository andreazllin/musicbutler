import { describe, expect, test } from "bun:test";
import { serialize } from "@musicbutler/lrc";
import { buildDocument } from "../src/sync/engine.ts";

const lines = ["la la la", "line two", "..."];
const words = [
	{ text: "la", start: 1.0, end: 1.2, line: 0 },
	{ text: "la", start: 1.3, end: 1.5, line: 0 },
	{ text: "la", start: 1.6, end: 1.8, line: 0 },
	{ text: "line", start: 3.0, end: 3.3, line: 1 },
	{ text: "two", start: 3.4, end: 3.7, line: 1 },
	// unalignable word: the engine gives it the previous word's end
	{ text: "...", start: 3.7, end: 3.7, line: 2 },
];

describe("buildDocument (write stage, docs/PLAN.md §8.2)", () => {
	test("one timed line per source line, word tags on, metadata preserved", () => {
		const doc = buildDocument("[ti:Song]\nla la la\nline two\n...", lines, words, {
			leadIn: 0,
			wordTimestamps: true,
		});
		expect(doc.meta).toEqual([{ key: "ti", value: "Song" }]);
		expect(doc.lines.map((l) => l.time)).toEqual([1.0, 3.0, 3.7]);
		expect(doc.lines[0]?.words?.map((w) => w.text)).toEqual(["la", "la", "la"]);
		expect(serialize(doc)).toBe(
			"[ti:Song]\n\n[00:01.00] <00:01.00>la <00:01.30>la <00:01.60>la\n[00:03.00] <00:03.00>line <00:03.40>two\n[00:03.70] <00:03.70>...\n",
		);
	});

	test("leadIn shifts every timestamp and clamps at 0", () => {
		const doc = buildDocument("", lines, words, { leadIn: 1.5, wordTimestamps: false });
		expect(doc.lines.map((l) => l.time)).toEqual([0, 1.5, 2.2]);
		expect(doc.lines[0]?.words).toBeUndefined();
		expect(serialize(doc)).toBe("[00:00.00]la la la\n[00:01.50]line two\n[00:02.20]...\n");
	});
});
