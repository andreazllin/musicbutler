import { describe, expect, test } from "bun:test";
import { type Line, type LrcDocument, parse, serialize } from "../src/index.ts";
import {
	ALL,
	CRLF,
	EMPTY,
	GARBAGE,
	LINE_LEVEL,
	META_ONLY,
	MM_OVER_59,
	NO_TRAILING_NEWLINE,
	REPEATED,
	WORD_LEVEL,
} from "./fixtures.ts";

/** Sorted lines without `sourceLine`, the shape the round trip is judged on (§5.6). */
function normalise(doc: LrcDocument): LrcDocument {
	const lines = [...doc.lines]
		.sort((a, b) => a.time - b.time)
		.map(({ time, text, words }): Line => (words ? { time, text, words } : { time, text }));
	return { meta: doc.meta, lines };
}

describe("parse", () => {
	test("line level timestamps and metadata", () => {
		const doc = parse(LINE_LEVEL);
		expect(doc.meta).toEqual([
			{ key: "ti", value: "Placeholder Title" },
			{ key: "ar", value: "Placeholder Artist" },
			{ key: "al", value: "Placeholder Album" },
		]);
		expect(doc.lines).toEqual([
			{ time: 1, text: "line one", sourceLine: 4 },
			{ time: 5.5, text: "line two", sourceLine: 5 },
			{ time: 62.75, text: "line three", sourceLine: 6 },
		]);
	});

	test("word level timestamps, text derived from the words", () => {
		const doc = parse(WORD_LEVEL);
		expect(doc.lines).toHaveLength(2);
		expect(doc.lines[0]).toEqual({
			time: 1,
			text: "la la la",
			words: [
				{ time: 1, text: "la" },
				{ time: 1.5, text: "la" },
				{ time: 2, text: "la" },
			],
			sourceLine: 0,
		});
		expect(doc.lines[1].words).toEqual([
			{ time: 5, text: "line" },
			{ time: 5.4, text: "two" },
		]);
	});

	test("word tags glued to the word and separated by a space both parse", () => {
		const a = parse("[00:01.00]<00:01.00>la <00:01.50>la\n").lines[0];
		const b = parse("[00:01.00] <00:01.00> la <00:01.50> la\n").lines[0];
		expect(a.words).toEqual(b.words);
		expect(a.text).toBe("la la");
	});

	test("text before the first word tag becomes a word at the line time", () => {
		const line = parse("[00:01.00]la <00:01.50>la\n").lines[0];
		expect(line.words).toEqual([
			{ time: 1, text: "la" },
			{ time: 1.5, text: "la" },
		]);
		expect(line.text).toBe("la la");
	});

	test("a line with several timestamps expands into separate lines", () => {
		const doc = parse(REPEATED);
		expect(doc.lines).toEqual([
			{ time: 10, text: "la la la", sourceLine: 0 },
			{ time: 50, text: "la la la", sourceLine: 0 },
			{ time: 15, text: "line one", sourceLine: 1 },
		]);
	});

	test("metadata only, unknown keys and [offset:] kept, not applied", () => {
		const doc = parse(META_ONLY);
		expect(doc.lines).toEqual([]);
		expect(doc.meta).toEqual([
			{ key: "ti", value: "Placeholder" },
			{ key: "ar", value: "Nobody" },
			{ key: "offset", value: "500" },
			{ key: "xcustom", value: "kept" },
		]);
	});

	test("[ti:Title] is metadata, never a timestamp", () => {
		const doc = parse("[ti:Title]\n[00:12.00]Title\n");
		expect(doc.meta).toEqual([{ key: "ti", value: "Title" }]);
		expect(doc.lines).toEqual([{ time: 12, text: "Title", sourceLine: 1 }]);
	});

	test("minutes above 59 are not converted to hours", () => {
		const doc = parse(MM_OVER_59);
		expect(doc.lines.map((l) => l.time)).toEqual([75 * 60, 125 * 60 + 30.25]);
	});

	test("CRLF input parses like LF input", () => {
		expect(parse(CRLF)).toEqual(parse(CRLF.replaceAll("\r\n", "\n")));
		expect(parse(CRLF).lines.map((l) => l.text)).toEqual(["line one", "line two"]);
	});

	test("a file without a trailing newline keeps its last line", () => {
		expect(parse(NO_TRAILING_NEWLINE).lines).toHaveLength(2);
	});

	test("the empty string is an empty document", () => {
		expect(parse(EMPTY)).toEqual({ meta: [], lines: [] });
	});

	test("a BOM is ignored", () => {
		expect(parse("﻿[ti:Placeholder]\n[00:01.00]la\n")).toEqual(
			parse("[ti:Placeholder]\n[00:01.00]la\n"),
		);
	});

	test("garbage lines are dropped without crashing", () => {
		const doc = parse(GARBAGE);
		expect(doc.meta).toEqual([{ key: "ti", value: "Placeholder" }]);
		expect(doc.lines).toEqual([
			{ time: 3, text: "line one", sourceLine: 5 },
			{ time: 4, text: "line two", sourceLine: 7 },
		]);
	});

	test("a malformed leading tag next to a valid one is skipped", () => {
		expect(parse("[99:99.99][00:04.00]la\n").lines).toEqual([
			{ time: 4, text: "la", sourceLine: 0 },
		]);
	});

	test("mm:ss and mm:ss.xxx and mm:ss:xx forms all parse", () => {
		const doc = parse("[00:04]a\n[00:05.123]b\n[00:06:50]c\n");
		expect(doc.lines.map((l) => l.time)).toEqual([4, 5.123, 6.5]);
	});
});

describe("serialize", () => {
	test("canonical output: metadata, blank line, sorted lines", () => {
		const doc: LrcDocument = {
			meta: [{ key: "ti", value: "Placeholder" }],
			lines: [
				{ time: 5.5, text: "line two" },
				{ time: 1, text: "line one" },
				{ time: 5.5, text: "line two again" },
			],
		};
		expect(serialize(doc)).toBe(
			"[ti:Placeholder]\n\n[00:01.00]line one\n[00:05.50]line two\n[00:05.50]line two again\n",
		);
	});

	test("words are written as ` <mm:ss.xx>word`", () => {
		const doc: LrcDocument = {
			meta: [],
			lines: [
				{
					time: 1,
					text: "la la",
					words: [
						{ time: 1, text: "la" },
						{ time: 1.5, text: "la" },
					],
				},
			],
		};
		expect(serialize(doc)).toBe("[00:01.00] <00:01.00>la <00:01.50>la\n");
	});

	test("no blank line without metadata; no trailing blank line without lines", () => {
		expect(serialize({ meta: [], lines: [{ time: 0, text: "la" }] })).toBe("[00:00.00]la\n");
		expect(serialize({ meta: [{ key: "ti", value: "x" }], lines: [] })).toBe("[ti:x]\n");
	});

	test("the empty document serializes to the empty string", () => {
		expect(serialize({ meta: [], lines: [] })).toBe("");
	});

	test("CRLF input serializes with LF only", () => {
		expect(serialize(parse(CRLF))).toBe(
			"[ti:Placeholder]\n\n[00:01.00]line one\n[00:02.00]line two\n",
		);
	});
});

describe("round trip", () => {
	for (const [name, text] of Object.entries(ALL)) {
		test(`parse(serialize(doc)) equals doc for ${name}`, () => {
			const doc = parse(text);
			expect(normalise(parse(serialize(doc)))).toEqual(normalise(doc));
		});

		test(`serialize is idempotent for ${name}`, () => {
			const once = serialize(parse(text));
			expect(serialize(parse(once))).toBe(once);
		});
	}
});
