/**
 * Path -> character segments -> words (docs/lyrics-sync-functionality-implementation-plan.md §5.9).
 */
import { ASR_FRAME_SEC } from "../config.ts";
import type { CharSegment, PathPoint, SourceWord, Tokenized, Word } from "../types.ts";

/** Collapses runs with the same tokenIndex; score = mean of the run. */
export function pathToCharSegments(path: PathPoint[]): CharSegment[] {
	const segs: CharSegment[] = [];
	let i = 0;
	while (i < path.length) {
		const first = path[i] as PathPoint;
		let j = i;
		let sum = 0;
		while (j < path.length && (path[j] as PathPoint).tokenIndex === first.tokenIndex) {
			sum += (path[j] as PathPoint).score;
			j++;
		}
		segs.push({
			tokenIndex: first.tokenIndex,
			startFrame: first.timeIndex,
			endFrame: (path[j - 1] as PathPoint).timeIndex + 1,
			score: sum / (j - i),
		});
		i = j;
	}
	return segs;
}

/**
 * Groups consecutive segments of the same word. `start` is the time of the
 * first frame; `end` is the end of the last frame (its start + one frame).
 * Unalignable words get start = end = the previous word's end (0 if first).
 * The result length equals `tok.words.length`.
 */
export function segmentsToWords(
	segs: CharSegment[],
	tok: Tokenized,
	frameTimes: Float32Array,
): Word[] {
	const frames = frameTimes.length;
	// Frame times are float32 (0.04 -> 0.0399999991); ms rounding loses nothing at a 20 ms stride.
	const ms = (x: number): number => Math.round(x * 1000) / 1000;
	const timeAt = (f: number): number => frameTimes[Math.min(Math.max(f, 0), frames - 1)] as number;
	const aligned = new Map<number, { start: number; end: number; score: number; n: number }>();
	for (const s of segs) {
		const wi = tok.charToWord[s.tokenIndex] as number;
		if (wi < 0) continue;
		const startT = timeAt(s.startFrame);
		const endT = timeAt(s.endFrame - 1) + ASR_FRAME_SEC;
		const cur = aligned.get(wi);
		if (cur) {
			cur.start = Math.min(cur.start, startT);
			cur.end = Math.max(cur.end, endT);
			cur.score += s.score;
			cur.n += 1;
		} else {
			aligned.set(wi, { start: startT, end: endT, score: s.score, n: 1 });
		}
	}
	const words: Word[] = [];
	let prevEnd = 0;
	for (let wi = 0; wi < tok.words.length; wi++) {
		const src = tok.words[wi] as SourceWord;
		const a = aligned.get(wi);
		if (a) {
			words.push({
				text: src.text,
				start: ms(a.start),
				end: ms(a.end),
				score: a.score / a.n,
				line: src.line,
			});
			prevEnd = ms(a.end);
		} else {
			words.push({ text: src.text, start: prevEnd, end: prevEnd, score: 0, line: src.line });
		}
	}
	if (words.length !== tok.words.length) throw new Error("segmentsToWords: word count mismatch");
	return words;
}
