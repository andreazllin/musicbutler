/**
 * Chunk planning and overlap-add for Demucs. Pure, unit tested. Ports the
 * reference infer.py (docs/lyrics-sync-functionality-implementation-plan.md §5.3,
 * docs/PLAN.md §13.10 and §13.11).
 */
import { DEMUCS_OVERLAP, DEMUCS_SEGMENT_SAMPLES } from "../config.ts";

/**
 * Ones with a linear fade-in over the first `overlap` samples and a linear
 * fade-out over the last `overlap` samples. The ramps are (i+1)/(overlap+1) so
 * that fade-in + fade-out of two neighbouring chunks sums to exactly 1 and no
 * weight is ever 0.
 */
export function makeWindow(n: number, overlap: number): Float32Array {
	const w = new Float32Array(n).fill(1);
	const ov = Math.min(overlap, n >> 1);
	for (let i = 0; i < ov; i++) {
		const ramp = (i + 1) / (ov + 1);
		w[i] = ramp;
		w[n - 1 - i] = ramp;
	}
	return w;
}

export interface Chunk {
	start: number;
	/** Exclusive; at most `total`. The caller zero-pads the last chunk to `n`. */
	end: number;
}

/** stride = n - overlap; covers [0, total) with no gaps. */
export function planChunks(
	total: number,
	n = DEMUCS_SEGMENT_SAMPLES,
	overlap = DEMUCS_OVERLAP,
): Chunk[] {
	if (total <= 0) return [];
	const stride = n - overlap;
	const nChunks = Math.max(1, Math.ceil(total / stride));
	const chunks: Chunk[] = [];
	for (let i = 0; i < nChunks; i++) {
		const start = i * stride;
		if (start >= total) break;
		chunks.push({ start, end: Math.min(start + n, total) });
	}
	return chunks;
}

/**
 * Weighted overlap-add accumulator. `finish()` divides by max(weight, 1e-8).
 *
 * Deviation from infer.py: the fade-in is skipped for the chunk that starts at
 * 0 and the fade-out for the chunk that ends at `total`, so the accumulated
 * weight is exactly 1 everywhere instead of ramping down at the signal edges.
 * The normalized result is the same; only the numerical conditioning differs.
 */
export class OverlapAdd {
	private readonly out: Float32Array[];
	private readonly weight: Float32Array;

	constructor(
		channels: number,
		readonly total: number,
		private readonly window: Float32Array,
		private readonly overlap = DEMUCS_OVERLAP,
	) {
		this.out = Array.from({ length: channels }, () => new Float32Array(total));
		this.weight = new Float32Array(total);
	}

	add(start: number, end: number, chunkOut: Float32Array[]): void {
		if (chunkOut.length !== this.out.length) throw new Error("OverlapAdd: channel count mismatch");
		const len = end - start;
		if (len <= 0 || end > this.total) throw new Error(`OverlapAdd: bad range [${start}, ${end})`);
		const n = this.window.length;
		const ov = Math.min(this.overlap, n >> 1);
		const flatHead = start === 0;
		const flatTail = end === this.total;
		for (let i = 0; i < len; i++) {
			let w = this.window[i] as number;
			if (flatHead && i < ov) w = 1;
			if (flatTail && i >= n - ov) w = 1;
			this.weight[start + i] = (this.weight[start + i] as number) + w;
			for (let c = 0; c < this.out.length; c++) {
				const o = this.out[c] as Float32Array;
				const x = (chunkOut[c] as Float32Array)[i] as number;
				o[start + i] = (o[start + i] as number) + w * x;
			}
		}
	}

	/** Accumulated weight per sample (for tests: proves that no gap exists). */
	weights(): Float32Array {
		return this.weight;
	}

	finish(): Float32Array[] {
		for (let i = 0; i < this.total; i++) {
			const w = Math.max(this.weight[i] as number, 1e-8);
			for (const o of this.out) o[i] = (o[i] as number) / w;
		}
		return this.out;
	}
}
