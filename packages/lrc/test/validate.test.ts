import { describe, expect, test } from "bun:test";
import { validate } from "../src/index.ts";
import { LINE_LEVEL, META_ONLY, REPEATED, WORD_LEVEL } from "./fixtures.ts";

describe("validate", () => {
	test("a clean file and a metadata-only file produce no diagnostics", () => {
		expect(validate(LINE_LEVEL)).toEqual([]);
		expect(validate(WORD_LEVEL)).toEqual([]);
		expect(validate(META_ONLY)).toEqual([]);
		expect(validate("")).toEqual([]);
	});

	test("[ti:Title] and section markers are not timestamps", () => {
		expect(validate("[ti:Title]\n[Chorus]\n[Verse 1]\nla <3 la\n")).toEqual([]);
	});

	test("error: malformed timestamp [1:2] with exact offsets", () => {
		const text = "[00:01.00]la\n[1:2]lb\n";
		const diags = validate(text);
		expect(diags).toHaveLength(1);
		expect(diags[0].severity).toBe("error");
		expect(diags[0].line).toBe(1);
		expect(text.slice(diags[0].from, diags[0].to)).toBe("[1:2]");
	});

	test("error: seconds of 60 or more, for line and word tags", () => {
		const diags = validate("[99:99.99]la\n[00:01.00] <00:01.00>la <00:60.00>lb\n");
		expect(diags.map((d) => d.severity)).toEqual(["error", "error"]);
		expect(diags[0].message).toContain("[99:99.99]");
		expect(diags[1].message).toContain("<00:60.00>");
		expect(diags[1].line).toBe(1);
	});

	test("error: unclosed bracket", () => {
		const text = "[00:12.3\n[00:01.00]la <00:12\n";
		const diags = validate(text);
		expect(diags.map((d) => d.severity)).toEqual(["error", "error"]);
		expect(text.slice(diags[0].from, diags[0].to)).toBe("[00:12.3");
		expect(text.slice(diags[1].from, diags[1].to)).toBe("<00:12");
		expect(diags[1].line).toBe(1);
	});

	test("warning: a timestamp earlier than the previous line", () => {
		const text = "[00:10.00]la\n[00:05.00]lb\n[00:06.00]lc\n";
		const diags = validate(text);
		expect(diags).toHaveLength(1);
		expect(diags[0].severity).toBe("warning");
		expect(diags[0].line).toBe(1);
		expect(text.slice(diags[0].from, diags[0].to)).toBe("[00:05.00]");
	});

	test("a repeated lyric with several tags does not trip the order check", () => {
		expect(validate(REPEATED)).toEqual([]);
	});

	test("warning: timestamp past the duration, only when a duration is given", () => {
		const text = "[00:01.00]la\n[05:00.00]lb <05:01.00>lc\n";
		expect(validate(text)).toEqual([]);
		const diags = validate(text, { durationSeconds: 240 });
		expect(diags.map((d) => d.severity)).toEqual(["warning", "warning"]);
		expect(text.slice(diags[0].from, diags[0].to)).toBe("[05:00.00]");
		expect(text.slice(diags[1].from, diags[1].to)).toBe("<05:01.00>");
	});

	test("info: duplicate timestamp", () => {
		const text = "[00:01.00]la\n[00:02.00]lb\n[00:02.00]lc\n";
		const diags = validate(text);
		expect(diags).toHaveLength(1);
		expect(diags[0]).toMatchObject({ severity: "info", line: 2 });
		expect(text.slice(diags[0].from, diags[0].to)).toBe("[00:02.00]");
	});

	test("offsets stay correct with CRLF line endings", () => {
		const text = "[ti:x]\r\n[00:01.00]la\r\n[1:2]lb\r\n";
		const diags = validate(text);
		expect(diags).toHaveLength(1);
		expect(diags[0].line).toBe(2);
		expect(text.slice(diags[0].from, diags[0].to)).toBe("[1:2]");
	});
});
