/**
 * Forced alignment: emission + tokens -> Word[] (docs/lyrics-sync-functionality-implementation-plan.md §5.8-§5.9).
 */
import { AlignError, type Emission, type Tokenized, type Word } from "../types.ts";
import { backtrack } from "./backtrack.ts";
import { pathToCharSegments, segmentsToWords } from "./segments.ts";
import { buildTrellis } from "./trellis.ts";

export { backtrack, buildTrellis, pathToCharSegments, segmentsToWords };

export function forcedAlign(em: Emission, tok: Tokenized, opts: { blankId: number }): Word[] {
	if (tok.tokens.length === 0) {
		throw new AlignError("no alignable words in the lyrics");
	}
	const trellis = buildTrellis(em, tok.tokens, opts.blankId);
	const path = backtrack(trellis, em, tok.tokens, opts.blankId);
	const segs = pathToCharSegments(path);
	return segmentsToWords(segs, tok, em.frameTimes);
}
