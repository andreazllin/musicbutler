/**
 * §5.3: overlap-add of a constant signal stays constant; planChunks covers
 * [0, total) with no gaps. Pure, no model.
 */
import { describe, expect, test } from "bun:test";
import { DEMUCS_OVERLAP, DEMUCS_SEGMENT_SAMPLES } from "../src/config.ts";
import { makeWindow, OverlapAdd, planChunks } from "../src/separation/chunking.ts";

describe("makeWindow", () => {
	test("is 1 in the middle and ramps linearly at both ends", () => {
		const w = makeWindow(100, 10);
		expect(w.length).toBe(100);
		expect(w[50]).toBe(1);
		expect(w[0]).toBeCloseTo(1 / 11, 6);
		expect(w[9]).toBeCloseTo(10 / 11, 6);
		expect(w[99]).toBeCloseTo(1 / 11, 6);
		// the fade-in of chunk B overlaps the fade-out of chunk A: w[i] + w[n-ov+i] = 1
		for (let i = 0; i < 10; i++) expect((w[i] as number) + (w[90 + i] as number)).toBeCloseTo(1, 6);
	});
	test("clamps the overlap at half the length", () => {
		const w = makeWindow(4, 100);
		expect(Array.from(w).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
			0.333333, 0.666667, 0.666667, 0.333333,
		]);
	});
});

describe("planChunks", () => {
	test("covers [0,total) with no gaps and no chunk longer than n", () => {
		for (const total of [1, 999, 1000, 1001, 2500, 12_345, 100_000]) {
			const chunks = planChunks(total, 1000, 250);
			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks[0]?.start).toBe(0);
			expect(chunks[chunks.length - 1]?.end).toBe(total);
			for (let i = 0; i < chunks.length; i++) {
				const c = chunks[i] as { start: number; end: number };
				expect(c.end - c.start).toBeLessThanOrEqual(1000);
				expect(c.end).toBeGreaterThan(c.start);
				if (i > 0) expect(c.start).toBeLessThanOrEqual((chunks[i - 1] as { end: number }).end);
			}
		}
	});
	test("uses the Demucs defaults", () => {
		const chunks = planChunks(60 * 44_100);
		const stride = DEMUCS_SEGMENT_SAMPLES - DEMUCS_OVERLAP;
		expect(chunks[1]?.start).toBe(stride);
		expect(chunks[0]?.end).toBe(DEMUCS_SEGMENT_SAMPLES);
		expect(chunks.length).toBe(Math.ceil((60 * 44_100) / stride));
	});
	test("returns nothing for an empty signal", () => {
		expect(planChunks(0)).toEqual([]);
	});
});

describe("OverlapAdd", () => {
	test("reconstructs a constant signal within 1e-6", () => {
		const n = 1000;
		const overlap = 250;
		for (const total of [1000, 1234, 4321, 7000]) {
			const chunks = planChunks(total, n, overlap);
			const ola = new OverlapAdd(2, total, makeWindow(n, overlap), overlap);
			for (const { start, end } of chunks) {
				const len = end - start;
				ola.add(start, end, [new Float32Array(len).fill(0.5), new Float32Array(len).fill(-0.25)]);
			}
			const w = ola.weights();
			for (let i = 0; i < total; i++) expect(w[i] as number).toBeGreaterThanOrEqual(1 - 1e-6);
			const [l, r] = ola.finish();
			for (let i = 0; i < total; i++) {
				expect(Math.abs((l?.[i] as number) - 0.5)).toBeLessThan(1e-6);
				expect(Math.abs((r?.[i] as number) + 0.25)).toBeLessThan(1e-6);
			}
		}
	});
	test("rejects a bad range and a channel mismatch", () => {
		const ola = new OverlapAdd(2, 100, makeWindow(50, 10), 10);
		expect(() => ola.add(0, 200, [new Float32Array(200), new Float32Array(200)])).toThrow();
		expect(() => ola.add(0, 50, [new Float32Array(50)])).toThrow();
	});
});
