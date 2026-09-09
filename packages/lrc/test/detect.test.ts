import { describe, expect, test } from "bun:test";
import { hasTimestamps, stripToPlainLyrics } from "../src/index.ts";
import { GARBAGE, LINE_LEVEL, META_ONLY, WORD_LEVEL } from "./fixtures.ts";

describe("hasTimestamps", () => {
	test("true for line timestamps in every accepted form", () => {
		expect(hasTimestamps("[00:12]la")).toBe(true);
		expect(hasTimestamps("[00:12.3]la")).toBe(true);
		expect(hasTimestamps("[00:12.34]la")).toBe(true);
		expect(hasTimestamps("[00:12.345]la")).toBe(true);
		expect(hasTimestamps("[00:12:34]la")).toBe(true);
		expect(hasTimestamps("[125:12.34]la")).toBe(true);
		expect(hasTimestamps(LINE_LEVEL)).toBe(true);
	});

	test("true for word timestamps alone", () => {
		expect(hasTimestamps("la <00:12.34>la")).toBe(true);
		expect(hasTimestamps(WORD_LEVEL)).toBe(true);
	});

	test("false for metadata such as [ti:Title]", () => {
		expect(hasTimestamps("[ti:Title]")).toBe(false);
		expect(hasTimestamps("[ti:12:34]")).toBe(false);
		expect(hasTimestamps(META_ONLY)).toBe(false);
	});

	test("false for plain lyrics, section markers and the empty string", () => {
		expect(hasTimestamps("")).toBe(false);
		expect(hasTimestamps("line one\nline two\n")).toBe(false);
		expect(hasTimestamps("[Chorus]\nla la la\n")).toBe(false);
		expect(hasTimestamps("[1:2]la")).toBe(false);
		expect(hasTimestamps("[00:12.3")).toBe(false);
	});
});

describe("stripToPlainLyrics", () => {
	test("drops metadata, timestamps, blank lines and section markers", () => {
		const text = [
			"[ti:Placeholder]",
			"[ar:Nobody]",
			"",
			"[Chorus]",
			"[00:01.00]line one",
			"[00:05.50]  line two  ",
			"",
			"[Verse 1]",
			"[00:10.00][00:50.00]la la la",
			"plain line",
		].join("\n");
		expect(stripToPlainLyrics(text)).toEqual(["line one", "line two", "la la la", "plain line"]);
	});

	test("removes word timestamps and collapses the spacing", () => {
		expect(stripToPlainLyrics(WORD_LEVEL)).toEqual(["la la la", "line two"]);
		expect(stripToPlainLyrics("[00:01.00]<00:01.00> la  <00:01.50> la\n")).toEqual(["la la"]);
	});

	test("metadata only yields no lyrics; garbage lines pass through", () => {
		expect(stripToPlainLyrics(META_ONLY)).toEqual([]);
		// `[1:2]` is not timestamp shaped and stays; `[99:99.99]` is shaped (§7.5) and goes.
		expect(stripToPlainLyrics(GARBAGE)).toEqual([
			"this line has no tag",
			"[1:2]bad tag",
			"worse tag",
			"line one",
			"line two",
		]);
	});

	test("handles CRLF and the empty string", () => {
		expect(stripToPlainLyrics("[00:01.00]line one\r\n\r\n[00:02.00]line two\r\n")).toEqual([
			"line one",
			"line two",
		]);
		expect(stripToPlainLyrics("")).toEqual([]);
	});
});
