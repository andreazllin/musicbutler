/**
 * The wav2vec2 window loop, apart from the runtime that executes the model
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.5).
 *
 * Fixes two weaknesses of the original (§1): the final partial window is kept
 * (the Python `librosa.util.frame` dropped it), and frame times come from the
 * window start plus the local frame index, so the 20 ms per-window drift
 * (240 000 samples give 749 frames, not 750) is gone.
 *
 * The server and the browser both load the model with Transformers.js, but
 * each from its own build of it. They hand this loop one function that runs
 * one window, so the windowing and the timing are the same code in both.
 */
import { ASR_FRAME_SAMPLES, ASR_FRAME_SEC, ASR_WINDOW_SAMPLES, TARGET_SR } from "../constants.ts";
import { type Emission, throwIfAborted } from "../types.ts";
import { logSoftmaxRows } from "./logsoftmax.ts";

/** Raw logits of one window, `[frames, classes]` row-major. */
export interface WindowLogits {
	data: Float32Array;
	frames: number;
	classes: number;
	/** Frees the tensor behind `data`. Called once the loop copied what it needs. */
	dispose?: () => void;
}

/** Runs the model on one window of 16 kHz mono audio. */
export type AsrWindowRunner = (window: Float32Array) => Promise<WindowLogits>;

export interface EmitOptions {
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
}

/**
 * Splits into 15 s windows including the final partial one (skipped only
 * when shorter than 2 frames), runs the model per window, log-softmaxes each
 * frame and stamps `frameTimes[f] = windowStartSec + localFrame * 0.02`.
 */
export async function emitWith(
	run: AsrWindowRunner,
	mono16k: Float32Array,
	opts: EmitOptions = {},
): Promise<Emission> {
	const total = mono16k.length;
	const starts: number[] = [];
	for (let s = 0; s < total; s += ASR_WINDOW_SAMPLES) {
		if (total - s >= 2 * ASR_FRAME_SAMPLES) starts.push(s);
	}
	const parts: Float32Array[] = [];
	const times: Float32Array[] = [];
	let frames = 0;
	let classes = 0;
	opts.onProgress?.(0, starts.length);
	for (let i = 0; i < starts.length; i++) {
		throwIfAborted(opts.signal);
		const start = starts[i] as number;
		const window = mono16k.subarray(start, Math.min(start + ASR_WINDOW_SAMPLES, total));
		const logits = await run(window);
		const F = logits.frames;
		const C = logits.classes;
		// Always trust the frame count of the output; do not assume n/320 (§7.6).
		if (F > 0) {
			parts.push(logSoftmaxRows(logits.data, F, C));
			const t = new Float32Array(F);
			const startSec = start / TARGET_SR;
			for (let f = 0; f < F; f++) t[f] = startSec + f * ASR_FRAME_SEC;
			times.push(t);
			frames += F;
			classes = C;
		}
		logits.dispose?.();
		opts.onProgress?.(i + 1, starts.length);
	}
	const logProbs = new Float32Array(frames * classes);
	const frameTimes = new Float32Array(frames);
	let off = 0;
	let fOff = 0;
	for (let i = 0; i < parts.length; i++) {
		logProbs.set(parts[i] as Float32Array, off);
		frameTimes.set(times[i] as Float32Array, fOff);
		off += (parts[i] as Float32Array).length;
		fOff += (times[i] as Float32Array).length;
	}
	return { logProbs, frames, classes, frameTimes };
}
