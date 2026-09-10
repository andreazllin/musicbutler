/**
 * §5.8: a synthetic 20x5 emission where class k is loud at frames [4k, 4k+3]
 * for the tokens [1,2,3]. The first frame of each token must be 4k.
 *
 * Inside a run the later frames also give the blank a share, otherwise every
 * frame of the run costs the same and float rounding decides the tie.
 */
import { describe, expect, test } from "bun:test";
import { backtrack } from "../src/align/backtrack.ts";
import { pathToCharSegments } from "../src/align/segments.ts";
import { buildTrellis } from "../src/align/trellis.ts";
import { logSoftmaxRows } from "../src/asr/logsoftmax.ts";
import { AlignError, type Emission } from "../src/types.ts";

export interface Run {
	cls: number;
	start: number;
	/** Exclusive. */
	end: number;
}

/** Frames outside every run are blank-dominated. Inside a run class `cls` is the argmax at every frame. */
export function runEmission(frames: number, classes: number, runs: Run[], blank: number): Emission {
	const raw = new Float32Array(frames * classes);
	for (let t = 0; t < frames; t++) {
		const run = runs.find((r) => t >= r.start && t < r.end);
		const row = raw.subarray(t * classes, (t + 1) * classes);
		if (!run) row[blank] = 10;
		else if (t === run.start) row[run.cls] = 10;
		else {
			row[run.cls] = 7;
			row[blank] = 6;
		}
	}
	const frameTimes = new Float32Array(frames);
	for (let t = 0; t < frames; t++) frameTimes[t] = t * 0.02;
	return { logProbs: logSoftmaxRows(raw, frames, classes), frames, classes, frameTimes };
}

const BLANK = 0;

describe("buildTrellis + backtrack", () => {
	test("finds the first frame 4k for token k", () => {
		const em = runEmission(
			20,
			5,
			[1, 2, 3].map((k) => ({ cls: k, start: 4 * k, end: 4 * k + 4 })),
			BLANK,
		);
		const tokens = Int32Array.from([1, 2, 3]);
		const trellis = buildTrellis(em, tokens, BLANK);
		expect(trellis.rows).toBe(21);
		expect(trellis.cols).toBe(4);
		expect(trellis.data[0]).toBe(0);
		expect(trellis.data[1]).toBe(-Infinity);
		const path = backtrack(trellis, em, tokens, BLANK);
		// Leading blanks are not on the path: it starts where token 0 is emitted.
		expect(path[0]).toMatchObject({ tokenIndex: 0, timeIndex: 4 });
		for (let i = 1; i < path.length; i++) {
			expect((path[i] as { timeIndex: number }).timeIndex).toBe(
				(path[i - 1] as { timeIndex: number }).timeIndex + 1,
			);
		}
		const segs = pathToCharSegments(path);
		expect(segs.map((s) => s.tokenIndex)).toEqual([0, 1, 2]);
		expect(segs.map((s) => s.startFrame)).toEqual([4, 8, 12]);
		for (const s of segs) expect(s.score).toBeGreaterThan(0.3);
		expect(segs[0]?.score).toBeLessThan(1);
	});

	test("handles a blank-dominated tail", () => {
		// tokens at frames 1..3 (class 1) and 5..6 (class 2), then 13 frames of blank.
		const em = runEmission(
			20,
			5,
			[
				{ cls: 1, start: 1, end: 4 },
				{ cls: 2, start: 5, end: 7 },
			],
			BLANK,
		);
		const tokens = Int32Array.from([1, 2]);
		const path = backtrack(buildTrellis(em, tokens, BLANK), em, tokens, BLANK);
		const segs = pathToCharSegments(path);
		expect(segs.map((s) => s.startFrame)).toEqual([1, 5]);
		// argmax over the whole last column: the path ends once every token is consumed,
		// because each trailing blank costs a little; the tail is not part of any word.
		const last = path[path.length - 1] as { timeIndex: number };
		expect(last.timeIndex).toBeGreaterThanOrEqual(5);
		expect(last.timeIndex).toBeLessThan(20);
		expect(segs.every((s) => s.endFrame <= 7)).toBe(true);
	});

	test("visits every token once, in order, with contiguous frames", () => {
		const em = runEmission(
			12,
			3,
			[
				{ cls: 1, start: 0, end: 3 },
				{ cls: 1, start: 3, end: 6 },
				{ cls: 2, start: 6, end: 9 },
			],
			BLANK,
		);
		const tokens = Int32Array.from([1, 1, 2]);
		const path = backtrack(buildTrellis(em, tokens, BLANK), em, tokens, BLANK);
		const segs = pathToCharSegments(path);
		expect(segs.map((s) => s.tokenIndex)).toEqual([0, 1, 2]);
		expect(segs.map((s) => s.startFrame)).toEqual([0, 3, 6]);
		for (let i = 1; i < segs.length; i++) {
			expect(segs[i]?.startFrame).toBe(segs[i - 1]?.endFrame as number);
		}
	});

	test("N > T throws AlignError early", () => {
		const em = runEmission(3, 5, [], BLANK);
		expect(() => buildTrellis(em, Int32Array.from([1, 2, 3, 4]), BLANK)).toThrow(AlignError);
	});

	test("an empty token list gives an empty path", () => {
		const em = runEmission(3, 5, [], BLANK);
		const tokens = new Int32Array(0);
		expect(backtrack(buildTrellis(em, tokens, BLANK), em, tokens, BLANK)).toEqual([]);
	});

	test("uses the given blank id, not 0", () => {
		// Same picture as the first test but the blank is class 4 and the tokens are [0,1,2].
		const em = runEmission(
			20,
			5,
			[1, 2, 3].map((k) => ({ cls: k - 1, start: 4 * k, end: 4 * k + 4 })),
			4,
		);
		const tokens = Int32Array.from([0, 1, 2]);
		const path = backtrack(buildTrellis(em, tokens, 4), em, tokens, 4);
		expect(pathToCharSegments(path).map((s) => s.startFrame)).toEqual([4, 8, 12]);
		// With the wrong blank id the same emission aligns differently (§7.15).
		const wrong = backtrack(buildTrellis(em, tokens, 0), em, tokens, 0);
		expect(pathToCharSegments(wrong).map((s) => s.startFrame)).not.toEqual([4, 8, 12]);
	});
});
