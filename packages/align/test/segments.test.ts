/** §5.9: path -> segments -> words, including unalignable words. */
import { describe, expect, test } from "bun:test";
import { forcedAlign } from "../src/align/index.ts";
import { pathToCharSegments, segmentsToWords } from "../src/align/segments.ts";
import { ASR_FRAME_SEC } from "../src/config.ts";
import { tokenizeLyrics } from "../src/text/tokenize.ts";
import { fakeVocab } from "../src/text/vocab.ts";
import type { PathPoint } from "../src/types.ts";
import { runEmission } from "./trellis.test.ts";

const V = fakeVocab("AB");

describe("pathToCharSegments", () => {
	test("collapses runs and averages the score", () => {
		const path: PathPoint[] = [
			{ tokenIndex: 0, timeIndex: 0, score: 0.2 },
			{ tokenIndex: 0, timeIndex: 1, score: 0.8 },
			{ tokenIndex: 1, timeIndex: 2, score: 1 },
			{ tokenIndex: 2, timeIndex: 3, score: 0.5 },
			{ tokenIndex: 2, timeIndex: 4, score: 0.5 },
			{ tokenIndex: 2, timeIndex: 5, score: 0.5 },
		];
		const segs = pathToCharSegments(path);
		expect(segs).toEqual([
			{ tokenIndex: 0, startFrame: 0, endFrame: 2, score: 0.5 },
			{ tokenIndex: 1, startFrame: 2, endFrame: 3, score: 1 },
			{ tokenIndex: 2, startFrame: 3, endFrame: 6, score: 0.5 },
		]);
	});
	test("empty path gives no segments", () => {
		expect(pathToCharSegments([])).toEqual([]);
	});
});

describe("segmentsToWords", () => {
	test("groups characters into words with original spelling and inserts unalignable words", () => {
		// "Ab ... ba" -> tokens A B | B A ; word 1 ("...") is unalignable.
		const tok = tokenizeLyrics("Ab ... ba", "en-US", V);
		expect(Array.from(tok.charToWord)).toEqual([0, 0, -1, 2, 2]);
		const frameTimes = Float32Array.from({ length: 10 }, (_, i) => i * ASR_FRAME_SEC);
		const segs = [
			{ tokenIndex: 0, startFrame: 1, endFrame: 2, score: 0.9 },
			{ tokenIndex: 1, startFrame: 2, endFrame: 4, score: 0.7 },
			{ tokenIndex: 2, startFrame: 4, endFrame: 5, score: 1 }, // delimiter
			{ tokenIndex: 3, startFrame: 6, endFrame: 7, score: 0.5 },
			{ tokenIndex: 4, startFrame: 7, endFrame: 9, score: 0.5 },
		];
		const words = segmentsToWords(segs, tok, frameTimes);
		expect(words.length).toBe(3);
		expect(words[0]?.text).toBe("Ab");
		expect(words[0]?.start).toBeCloseTo(0.02, 6);
		expect(words[0]?.end).toBeCloseTo(0.08, 6);
		expect(words[0]?.score).toBeCloseTo(0.8, 6);
		expect(words[0]?.line).toBe(0);
		// unalignable: start = end = previous word's end, score 0
		expect(words[1]).toEqual({
			text: "...",
			start: words[0]?.end ?? -1,
			end: words[0]?.end ?? -1,
			score: 0,
			line: 0,
		});
		expect(words[2]?.text).toBe("ba");
		expect(words[2]?.start).toBeCloseTo(0.12, 6);
		expect(words[2]?.end).toBeCloseTo(0.18, 6);
	});
	test("an unalignable first word starts at 0", () => {
		const tok = tokenizeLyrics("... a", "en-US", V);
		const frameTimes = Float32Array.from({ length: 4 }, (_, i) => i * ASR_FRAME_SEC);
		const words = segmentsToWords(
			[{ tokenIndex: 0, startFrame: 2, endFrame: 3, score: 1 }],
			tok,
			frameTimes,
		);
		expect(words[0]).toEqual({ text: "...", start: 0, end: 0, score: 0, line: 0 });
		expect(words[1]?.start).toBeCloseTo(0.04, 6);
	});
	test("clamps the end frame to the last frame", () => {
		const tok = tokenizeLyrics("a", "en-US", V);
		const frameTimes = Float32Array.from([0, 0.02, 0.04]);
		const words = segmentsToWords(
			[{ tokenIndex: 0, startFrame: 2, endFrame: 3, score: 1 }],
			tok,
			frameTimes,
		);
		expect(words[0]?.end).toBeCloseTo(0.06, 6);
	});
});

describe("forcedAlign", () => {
	test("end to end on a synthetic emission with a vocabulary blank id", () => {
		const tok = tokenizeLyrics("ab\nba", "en-US", V); // A B | B A
		const C = V.idToChar.length;
		const a = V.charToId.get("A") as number;
		const b = V.charToId.get("B") as number;
		const plan = [a, b, V.wordDelimId, b, a];
		// each token spans 3 frames starting at frame 5
		const em = runEmission(
			30,
			C,
			plan.map((cls, i) => ({ cls, start: 5 + 3 * i, end: 8 + 3 * i })),
			V.blankId,
		);
		const words = forcedAlign(em, tok, { blankId: V.blankId });
		expect(words.map((w) => w.text)).toEqual(["ab", "ba"]);
		expect(words[0]?.start).toBeCloseTo(5 * ASR_FRAME_SEC, 6);
		expect(words[0]?.end).toBeCloseTo(11 * ASR_FRAME_SEC, 6);
		expect(words[1]?.start).toBeCloseTo(14 * ASR_FRAME_SEC, 6);
		expect(words[1]?.line).toBe(1);
		for (const w of words) expect(w.score).toBeGreaterThan(0.3);
	});
	test("throws AlignError when nothing is alignable", () => {
		const tok = tokenizeLyrics("... 123", "en-US", V);
		const em = runEmission(5, 7, [], V.blankId);
		expect(() => forcedAlign(em, tok, { blankId: V.blankId })).toThrow("no alignable words");
	});
});
