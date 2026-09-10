/**
 * Decode and resample through the system ffmpeg
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.2).
 */
import { deinterleave } from "./ops.ts";

export const FFMPEG_MISSING = "ffmpeg not found on PATH. Install it with: brew install ffmpeg";

export function ffmpegPath(): string {
	const p = Bun.which("ffmpeg");
	if (!p) throw new Error(FFMPEG_MISSING);
	return p;
}

let soxrProbe: Promise<boolean> | undefined;
/** True when this ffmpeg build links libsoxr (better resampler). Cached. */
export function hasSoxr(): Promise<boolean> {
	soxrProbe ??= (async () => {
		try {
			const proc = Bun.spawn([ffmpegPath(), "-hide_banner", "-version"], {
				stdout: "pipe",
				stderr: "ignore",
			});
			const text = await new Response(proc.stdout).text();
			await proc.exited;
			return text.includes("--enable-libsoxr");
		} catch {
			return false;
		}
	})();
	return soxrProbe;
}

async function runFfmpeg(args: string[], stdin?: Uint8Array): Promise<Float32Array> {
	const bin = ffmpegPath();
	const proc = Bun.spawn([bin, "-v", "error", "-nostdin", ...args], {
		stdin: stdin ?? "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	// Read stdout fully before checking the exit code (§7.9).
	const [buf, err] = await Promise.all([
		new Response(proc.stdout).arrayBuffer(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	if (code !== 0) throw new Error(`ffmpeg exited with code ${code}: ${err.trim()}`);
	const usable = buf.byteLength - (buf.byteLength % 4);
	return new Float32Array(buf, 0, usable / 4);
}

/** Decodes any file to planar float32 at `sampleRate` with `channels` channels. */
export async function decodeToF32(
	path: string,
	opts: { sampleRate: number; channels: 1 | 2 },
): Promise<Float32Array[]> {
	const flat = await runFfmpeg([
		"-i",
		path,
		"-map",
		"0:a:0",
		"-vn",
		"-f",
		"f32le",
		"-acodec",
		"pcm_f32le",
		"-ac",
		String(opts.channels),
		"-ar",
		String(opts.sampleRate),
		"pipe:1",
	]);
	if (flat.length % opts.channels !== 0) {
		throw new Error(`ffmpeg output length ${flat.length} is not a multiple of ${opts.channels}`);
	}
	return deinterleave(flat, opts.channels);
}

/** Resamples a mono signal. Uses soxr when the ffmpeg build has it, else swresample. */
export async function resampleMono(
	x: Float32Array,
	from: number,
	to: number,
): Promise<Float32Array> {
	if (from === to) return x;
	const soxr = await hasSoxr();
	const input = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
	return runFfmpeg(
		[
			"-f",
			"f32le",
			"-ar",
			String(from),
			"-ac",
			"1",
			"-i",
			"pipe:0",
			...(soxr ? ["-af", "aresample=resampler=soxr"] : []),
			"-f",
			"f32le",
			"-acodec",
			"pcm_f32le",
			"-ar",
			String(to),
			"-ac",
			"1",
			"pipe:1",
		],
		input,
	);
}

/** Duration in seconds via ffprobe-less decode header: uses ffmpeg's `-f null` is slower, so read from sample count instead. */
export function durationSec(samples: number, sampleRate: number): number {
	return samples / sampleRate;
}
