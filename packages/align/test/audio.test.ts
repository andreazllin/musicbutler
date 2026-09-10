/**
 * §6 M2: sine round trip through ffmpeg, resample length, missing-ffmpeg error.
 * Skipped when ffmpeg is absent. No model download.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeToF32, FFMPEG_MISSING, resampleMono } from "../src/audio/ffmpeg.ts";
import { deinterleave, downmixToMono, interleave, padTo, rms } from "../src/audio/ops.ts";
import { encodeWav16, writeWav16 } from "../src/audio/wav.ts";

const hasFfmpeg = Bun.which("ffmpeg") !== null;

describe("ops", () => {
	test("deinterleave / interleave round trip", () => {
		const x = Float32Array.from([1, 10, 2, 20, 3, 30]);
		const [l, r] = deinterleave(x, 2);
		expect(Array.from(l ?? [])).toEqual([1, 2, 3]);
		expect(Array.from(r ?? [])).toEqual([10, 20, 30]);
		expect(Array.from(interleave([l as Float32Array, r as Float32Array]))).toEqual(Array.from(x));
	});
	test("downmixToMono averages the channels", () => {
		const m = downmixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]);
		expect(Array.from(m)).toEqual([0.5, 0.5]);
	});
	test("padTo zero-pads and truncates", () => {
		expect(Array.from(padTo(Float32Array.from([1, 2]), 4))).toEqual([1, 2, 0, 0]);
		expect(Array.from(padTo(Float32Array.from([1, 2, 3]), 2))).toEqual([1, 2]);
	});
	test("rms", () => {
		expect(rms(Float32Array.from([1, -1, 1, -1]))).toBe(1);
		expect(rms(new Float32Array(0))).toBe(0);
	});
});

describe("wav", () => {
	test("encodeWav16 writes a 44-byte header and 16-bit samples", () => {
		const bytes = encodeWav16(
			[Float32Array.from([0, 1, -1]), Float32Array.from([0.5, 0, 0])],
			8000,
		);
		expect(bytes.length).toBe(44 + 3 * 2 * 2);
		const v = new DataView(bytes.buffer);
		expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
		expect(v.getUint16(22, true)).toBe(2);
		expect(v.getUint32(24, true)).toBe(8000);
		expect(v.getInt16(44, true)).toBe(0);
		expect(v.getInt16(46, true)).toBe(16384);
		expect(v.getInt16(48, true)).toBe(32767);
		expect(v.getInt16(52, true)).toBe(-32768);
	});
});

describe.skipIf(!hasFfmpeg)("ffmpeg", () => {
	test("sine round trip: 1 s at 44.1 kHz stereo, peak about 1/sqrt(2), resample to 16 kHz", async () => {
		const dir = await mkdtemp(join(tmpdir(), "align-audio-"));
		try {
			const sine = join(dir, "sine.wav");
			const proc = Bun.spawn(
				[
					Bun.which("ffmpeg") as string,
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"aevalsrc=0.7071*sin(440*2*PI*t):s=44100:d=1:c=stereo",
					sine,
				],
				{ stdout: "ignore", stderr: "pipe" },
			);
			expect(await proc.exited).toBe(0);
			const ch = await decodeToF32(sine, { sampleRate: 44100, channels: 2 });
			expect(ch.length).toBe(2);
			expect(ch[0]?.length).toBe(44100);
			expect(ch[1]?.length).toBe(44100);
			let peak = 0;
			for (const v of ch[0] as Float32Array) {
				expect(Number.isFinite(v)).toBe(true);
				peak = Math.max(peak, Math.abs(v));
			}
			expect(peak).toBeCloseTo(Math.SQRT1_2, 2);
			const mono = downmixToMono(ch);
			const r = await resampleMono(mono, 44100, 16000);
			expect(Math.abs(r.length - Math.round((44100 * 16000) / 44100))).toBeLessThanOrEqual(2);
			expect(Math.abs(rms(r) - rms(mono))).toBeLessThan(0.01);

			// WAV writer output decodes back to the same signal.
			const out = join(dir, "out.wav");
			await writeWav16(out, [mono], 16000);
			const [back] = await decodeToF32(out, { sampleRate: 16000, channels: 1 });
			expect(back?.length).toBe(mono.length);
			let maxErr = 0;
			for (let i = 0; i < mono.length; i++) {
				maxErr = Math.max(maxErr, Math.abs((back?.[i] as number) - (mono[i] as number)));
			}
			expect(maxErr).toBeLessThan(1e-3);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("decoding a missing file reports the ffmpeg error", async () => {
		await expect(
			decodeToF32("/nonexistent/file.mp3", { sampleRate: 16000, channels: 1 }),
		).rejects.toThrow(/ffmpeg exited with code/);
	});
});

describe("missing ffmpeg", () => {
	test("a subprocess with PATH=/nonexistent gets the install hint", async () => {
		const script = `import { ffmpegPath } from "${join(import.meta.dir, "../src/audio/ffmpeg.ts")}"; try { ffmpegPath(); console.log("FOUND"); } catch (e) { console.log((e as Error).message); }`;
		const proc = Bun.spawn([process.execPath, "-e", script], {
			env: { ...process.env, PATH: "/nonexistent" },
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(out.trim()).toBe(FFMPEG_MISSING);
	});
});
