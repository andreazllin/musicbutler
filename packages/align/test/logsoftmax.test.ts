/** §7.4: every row of the log-softmax sums to 1 in exp space. */
import { describe, expect, test } from "bun:test";
import { logSoftmaxRows } from "../src/asr/logsoftmax.ts";

describe("logSoftmaxRows", () => {
	test("rows sum to 1 in exp space and keep the argmax", () => {
		const rows = 50;
		const cols = 32;
		const data = new Float32Array(rows * cols);
		for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.37) * 20 - (i % 7);
		const out = logSoftmaxRows(data, rows, cols);
		expect(out.length).toBe(rows * cols);
		for (let r = 0; r < rows; r++) {
			let sum = 0;
			let argIn = 0;
			let argOut = 0;
			for (let c = 0; c < cols; c++) {
				sum += Math.exp(out[r * cols + c] as number);
				if ((data[r * cols + c] as number) > (data[r * cols + argIn] as number)) argIn = c;
				if ((out[r * cols + c] as number) > (out[r * cols + argOut] as number)) argOut = c;
			}
			expect(Math.abs(sum - 1)).toBeLessThan(1e-5);
			expect(argOut).toBe(argIn);
		}
	});
	test("handles a huge row max without overflow", () => {
		const out = logSoftmaxRows(new Float32Array([1000, 1000, -1000]), 1, 3);
		expect(out[0]).toBeCloseTo(Math.log(0.5), 5);
		expect(Number.isFinite(out[2] as number)).toBe(true);
	});
	test("throws on short data", () => {
		expect(() => logSoftmaxRows(new Float32Array(3), 2, 2)).toThrow();
	});
});
