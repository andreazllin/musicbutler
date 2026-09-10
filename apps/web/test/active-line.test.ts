import { describe, expect, test } from "bun:test";
import { findActiveLine } from "../src/features/lyrics-sync/helpers/active-line.ts";

describe("findActiveLine", () => {
	const times = [0.5, 2, 2, 4.25, 10];
	test("returns -1 before the first line", () => {
		expect(findActiveLine(times, 0)).toBe(-1);
		expect(findActiveLine(times, 0.49)).toBe(-1);
	});
	test("returns the last line whose time is <= t", () => {
		expect(findActiveLine(times, 0.5)).toBe(0);
		expect(findActiveLine(times, 1.99)).toBe(0);
		expect(findActiveLine(times, 2)).toBe(2);
		expect(findActiveLine(times, 5)).toBe(3);
		expect(findActiveLine(times, 100)).toBe(4);
	});
	test("handles an empty list", () => {
		expect(findActiveLine([], 3)).toBe(-1);
	});
});
