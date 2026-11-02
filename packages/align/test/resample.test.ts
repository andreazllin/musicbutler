import { describe, expect, test } from "bun:test";
import { resampleSinc } from "../src/audio/resample.ts";

function sine(freq: number, rate: number, seconds: number): Float32Array {
	const n = Math.round(rate * seconds);
	const x = new Float32Array(n);
	for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / rate);
	return x;
}

/** RMS of the difference, ignoring `edge` samples at each end. */
function rmsError(a: Float32Array, b: Float32Array, edge: number): number {
	let s = 0;
	let count = 0;
	for (let i = edge; i < Math.min(a.length, b.length) - edge; i++) {
		const d = (a[i] as number) - (b[i] as number);
		s += d * d;
		count++;
	}
	return Math.sqrt(s / count);
}

describe("resampleSinc", () => {
	test("returns the input when the rates match", () => {
		const x = new Float32Array([1, 2, 3]);
		expect(resampleSinc(x, 16000, 16000)).toBe(x);
	});

	test("44.1 kHz to 16 kHz keeps the length ratio", () => {
		const out = resampleSinc(new Float32Array(44100), 44100, 16000);
		expect(out.length).toBe(16000);
	});

	test("a tone inside the passband survives the downsample", () => {
		const x = sine(1000, 44100, 1);
		const expected = sine(1000, 16000, 1);
		const out = resampleSinc(x, 44100, 16000);
		expect(rmsError(out, expected, 64)).toBeLessThan(1e-3);
	});

	test("a tone above the new Nyquist frequency is removed, not folded back", () => {
		const out = resampleSinc(sine(12000, 44100, 1), 44100, 16000);
		let s = 0;
		for (let i = 64; i < out.length - 64; i++) s += (out[i] as number) ** 2;
		expect(Math.sqrt(s / (out.length - 128))).toBeLessThan(1e-3);
	});

	test("a constant stays constant", () => {
		const out = resampleSinc(new Float32Array(4410).fill(0.5), 44100, 16000);
		for (let i = 64; i < out.length - 64; i++) expect(out[i]).toBeCloseTo(0.5, 5);
	});

	test("upsampling keeps a tone", () => {
		const out = resampleSinc(sine(440, 16000, 0.5), 16000, 44100);
		expect(rmsError(out, sine(440, 44100, 0.5), 128)).toBeLessThan(1e-3);
	});

	test("rejects a rate that is not a positive integer", () => {
		expect(() => resampleSinc(new Float32Array(4), 44100.5, 16000)).toThrow();
	});
});
