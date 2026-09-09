import { describe, expect, test } from "bun:test";
import { formatTime, parseTime } from "../src/index.ts";

describe("parseTime", () => {
	test("accepts mm:ss, mm:ss.x, mm:ss.xx, mm:ss.xxx and mm:ss:xx", () => {
		expect(parseTime("00:12")).toBe(12);
		expect(parseTime("00:12.3")).toBe(12.3);
		expect(parseTime("00:12.34")).toBe(12.34);
		expect(parseTime("00:12.345")).toBe(12.345);
		expect(parseTime("00:12:34")).toBe(12.34);
		expect(parseTime("1:02.00")).toBe(62);
	});

	test("minutes may have three digits and exceed 59", () => {
		expect(parseTime("75:00.00")).toBe(4500);
		expect(parseTime("125:30.25")).toBe(7530.25);
	});

	test("tolerates one pair of surrounding brackets", () => {
		expect(parseTime("[00:12.34]")).toBe(12.34);
		expect(parseTime("<00:12.34>")).toBe(12.34);
	});

	test("rejects malformed input", () => {
		expect(parseTime("[1:2]")).toBeNull();
		expect(parseTime("1:2")).toBeNull();
		expect(parseTime("[99:99.99]")).toBeNull();
		expect(parseTime("00:60")).toBeNull();
		expect(parseTime("00:12.3456")).toBeNull();
		expect(parseTime("1234:00")).toBeNull();
		expect(parseTime("ti:Title")).toBeNull();
		expect(parseTime("")).toBeNull();
		expect(parseTime("12")).toBeNull();
	});
});

describe("formatTime", () => {
	test("pads minutes to two digits and floors to centiseconds", () => {
		expect(formatTime(0)).toBe("[00:00.00]");
		expect(formatTime(12.34)).toBe("[00:12.34]");
		expect(formatTime(12.345)).toBe("[00:12.34]");
		expect(formatTime(12.999)).toBe("[00:12.99]");
		expect(formatTime(62.75)).toBe("[01:02.75]");
		expect(formatTime(59.999)).toBe("[00:59.99]");
	});

	test("allows three minute digits from 100 minutes and never converts to hours", () => {
		expect(formatTime(75 * 60)).toBe("[75:00.00]");
		expect(formatTime(100 * 60 + 1.5)).toBe("[100:01.50]");
	});

	test("clamps negative and non-finite values at zero", () => {
		expect(formatTime(-3)).toBe("[00:00.00]");
		expect(formatTime(Number.NaN)).toBe("[00:00.00]");
	});

	test("word kind uses angle brackets", () => {
		expect(formatTime(1.5, "word")).toBe("<00:01.50>");
	});

	test("round trips through parseTime at centisecond precision", () => {
		for (const s of [0, 0.01, 1.1, 12.34, 59.99, 61.01, 3599.99]) {
			expect(parseTime(formatTime(s))).toBe(s);
		}
	});
});
