/**
 * Backtrack through the trellis (docs/lyrics-sync-functionality-implementation-plan.md §5.8).
 */
import { AlignError, type Emission, type PathPoint, type Trellis } from "../types.ts";

export function backtrack(
	trellis: Trellis,
	em: Emission,
	tokens: Int32Array,
	blankId = 0,
): PathPoint[] {
	const N = tokens.length;
	const { data, rows, cols } = trellis;
	const C = em.classes;
	const E = em.logProbs;
	if (N === 0) return [];
	// Python takes argmax over the whole last column, rows 0..T.
	let tStart = 0;
	let best = -Infinity;
	for (let t = 0; t < rows; t++) {
		const v = data[t * cols + N] as number;
		if (v > best) {
			best = v;
			tStart = t;
		}
	}
	if (!Number.isFinite(best)) throw new AlignError("backtrack: no finite path through the trellis");
	let j = N;
	const path: PathPoint[] = [];
	for (let t = tStart; t > 0; t--) {
		const eOff = (t - 1) * C;
		const stayed = (data[(t - 1) * cols + j] as number) + (E[eOff + blankId] as number);
		const tok = tokens[j - 1] as number;
		const changed = (data[(t - 1) * cols + j - 1] as number) + (E[eOff + tok] as number);
		const prob = Math.exp(E[eOff + (changed > stayed ? tok : blankId)] as number);
		path.push({ tokenIndex: j - 1, timeIndex: t - 1, score: prob });
		if (changed > stayed) {
			j -= 1;
			if (j === 0) return path.reverse();
		}
	}
	throw new AlignError("backtrack failed to reach token 0");
}
