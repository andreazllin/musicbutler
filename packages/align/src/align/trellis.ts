/**
 * CTC forced-alignment trellis (docs/lyrics-sync-functionality-implementation-plan.md §5.8).
 * Ports the PyTorch forced-alignment tutorial that lyrics-sync uses.
 */
import { AlignError, type Emission, type Trellis } from "../types.ts";

export function buildTrellis(em: Emission, tokens: Int32Array, blankId = 0): Trellis {
	const T = em.frames;
	const N = tokens.length;
	const C = em.classes;
	if (N > T) {
		throw new AlignError(
			`lyrics longer than audio frames (${N} tokens, ${T} frames): check that the lyrics match the audio`,
		);
	}
	const rows = T + 1;
	const cols = N + 1;
	const data = new Float32Array(rows * cols);
	const E = em.logProbs;
	// Row 0: trellis[0][0] = 0, trellis[0][1..N] = -Inf
	for (let j = 1; j < cols; j++) data[j] = -Infinity;
	for (let t = 0; t < T; t++) {
		const eOff = t * C;
		const blank = E[eOff + blankId] as number;
		const cur = t * cols;
		const next = (t + 1) * cols;
		data[next] = (data[cur] as number) + blank;
		for (let j = 1; j < cols; j++) {
			const stay = (data[cur + j] as number) + blank;
			const change =
				(data[cur + j - 1] as number) + (E[eOff + (tokens[j - 1] as number)] as number);
			data[next + j] = stay > change ? stay : change;
		}
	}
	return { data, rows, cols };
}
