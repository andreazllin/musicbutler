/**
 * The HTDemucs chunk loop, apart from the runtime that executes the graph
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.4).
 *
 * The server runs the graph with onnxruntime-node and the browser runs it with
 * onnxruntime-web. Both hand this loop one function that runs one chunk, so
 * the chunking, the padding and the overlap-add are the same code in both.
 */
import { padTo } from "../audio/ops.ts";
import { DEMUCS_OVERLAP, DEMUCS_SEGMENT_SAMPLES, DEMUCS_VOCALS_INDEX } from "../constants.ts";
import { throwIfAborted } from "../types.ts";
import { type Chunk, makeWindow, OverlapAdd, planChunks } from "./chunking.ts";

/**
 * Runs the graph on one chunk. `mix` is `[1, 2, N]` channel-major (L then R)
 * with `N = DEMUCS_SEGMENT_SAMPLES`. The result is the stems tensor, `[4][2][N]`.
 * The buffer behind `mix` is reused for the next chunk, so the function must
 * finish with it before it resolves.
 */
export type DemucsChunkRunner = (mix: Float32Array) => Promise<Float32Array>;

export interface SeparateOptions {
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
	/** Lets tests inspect the overlap-add weights. */
	onWeights?: (weights: Float32Array) => void;
}

/**
 * Input: stereo 44.1 kHz (a mono input is duplicated). Output: vocals [L, R]
 * of the same length. Fires `onProgress` once per chunk and honours `signal`
 * between chunks.
 */
export async function separateVocalsWith(
	run: DemucsChunkRunner,
	stereo: [Float32Array, Float32Array] | [Float32Array],
	opts: SeparateOptions = {},
): Promise<[Float32Array, Float32Array]> {
	const L = stereo[0];
	const R = stereo[1] ?? stereo[0];
	if (L.length !== R.length) throw new Error("demucs: channel length mismatch");
	const total = L.length;
	const N = DEMUCS_SEGMENT_SAMPLES;
	const chunks = planChunks(total, N, DEMUCS_OVERLAP);
	const ola = new OverlapAdd(2, total, makeWindow(N, DEMUCS_OVERLAP), DEMUCS_OVERLAP);
	const mix = new Float32Array(2 * N);
	opts.onProgress?.(0, chunks.length);
	for (let i = 0; i < chunks.length; i++) {
		throwIfAborted(opts.signal);
		const { start, end } = chunks[i] as Chunk;
		const clen = end - start;
		// [1, 2, N] channel-major: L then R, zero-padded tail.
		mix.set(padTo(L.subarray(start, end), N), 0);
		mix.set(padTo(R.subarray(start, end), N), N);
		const d = await run(mix);
		// Layout [4][2][N]: element (s, c, i) at ((s*2)+c)*N + i (§7.3).
		const lOff = (DEMUCS_VOCALS_INDEX * 2 + 0) * N;
		const rOff = (DEMUCS_VOCALS_INDEX * 2 + 1) * N;
		ola.add(start, end, [d.subarray(lOff, lOff + clen), d.subarray(rOff, rOff + clen)]);
		opts.onProgress?.(i + 1, chunks.length);
	}
	opts.onWeights?.(ola.weights());
	const [vl, vr] = ola.finish();
	return [vl as Float32Array, vr as Float32Array];
}
