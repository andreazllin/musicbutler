import { describe, expect, test } from "bun:test";
import { shiftTimestamps } from "../src/index.ts";
import { CRLF, LINE_LEVEL } from "./fixtures.ts";

describe("shiftTimestamps", () => {
	test("shifts every line timestamp forward", () => {
		expect(shiftTimestamps("[00:01.00]line one\n[01:59.50]line two\n", 0.75)).toBe(
			"[00:01.75]line one\n[02:00.25]line two\n",
		);
	});

	test("shifts backward and shifts word timestamps too", () => {
		expect(shiftTimestamps("[00:05.00] <00:05.00>la <00:05.40>la\n", -1.2)).toBe(
			"[00:03.80] <00:03.80>la <00:04.20>la\n",
		);
	});

	test("clamps at zero", () => {
		expect(shiftTimestamps("[00:01.00]la <00:01.50>la\n[00:03.00]lb\n", -2)).toBe(
			"[00:00.00]la <00:00.00>la\n[00:01.00]lb\n",
		);
	});

	test("preserves metadata, blank lines, untimed lines and spacing byte for byte", () => {
		const shifted = shiftTimestamps(LINE_LEVEL, 1);
		expect(shifted).toBe(
			LINE_LEVEL.replace("[00:01.00]", "[00:02.00]")
				.replace("[00:05.50]", "[00:06.50]")
				.replace("[01:02.75]", "[01:03.75]"),
		);
		const odd = "[ti:Placeholder]\n\n   [00:01.00]   spaced   \n[Chorus]\nplain line\n\n";
		expect(shiftTimestamps(odd, 0.5)).toBe(
			"[ti:Placeholder]\n\n   [00:01.50]   spaced   \n[Chorus]\nplain line\n\n",
		);
	});

	test("preserves CRLF line endings", () => {
		const shifted = shiftTimestamps(CRLF, 0.5);
		expect(shifted).toBe("[ti:Placeholder]\r\n\r\n[00:01.50]line one\r\n[00:02.50]line two\r\n");
	});

	test("never touches [ti:...] or malformed tags", () => {
		const text = "[ti:12:34]\n[1:2]la\n[99:99.99]lb\n[00:12.3\n";
		expect(shiftTimestamps(text, 1)).toBe(text);
	});

	test("keeps millisecond precision and minute width when the source had them", () => {
		expect(shiftTimestamps("[00:01.123]la\n[00:02]lb\n[100:00.00]lc\n", 0.01)).toBe(
			"[00:01.133]la\n[00:02.01]lb\n[100:00.01]lc\n",
		);
	});

	test("a zero offset is the identity", () => {
		expect(shiftTimestamps(LINE_LEVEL, 0)).toBe(LINE_LEVEL);
	});
});
