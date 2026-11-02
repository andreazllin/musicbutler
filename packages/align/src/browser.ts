/**
 * The alignment engine for a browser (docs/DECISIONS.md, 2026-11-02).
 *
 * `index.ts` is the Node build: it decodes with ffmpeg, runs onnxruntime-node
 * and reads models from a directory. None of that exists in a Web Worker. This
 * entry exports only the parts that run anywhere, and `alignBuffers`, which
 * chains them in the same order as `LyricsSync.syncFromBuffers`.
 *
 * The caller owns the runtime: it loads the models with onnxruntime-web and
 * Transformers.js, and hands in one function per model. So this module, and
 * everything it imports, stays free of Node built-ins and of `process`.
 */
import type { Lang } from "@musicbutler/shared";
import { forcedAlign } from "./align/index.ts";
import { type AsrWindowRunner, emitWith } from "./asr/emit.ts";
import { downmixToMono } from "./audio/ops.ts";
import { resampleSinc } from "./audio/resample.ts";
import { ORIGINAL_SR, TARGET_SR } from "./constants.ts";
import { type DemucsChunkRunner, separateVocalsWith } from "./separation/separate.ts";
import { tokenizeLyrics } from "./text/tokenize.ts";
import { AlignError, type ProgressFn, throwIfAborted, type Vocab, type Word } from "./types.ts";

export type { AsrWindowRunner, WindowLogits } from "./asr/emit.ts";
export { emitWith } from "./asr/emit.ts";
export { downmixToMono } from "./audio/ops.ts";
export { resampleSinc } from "./audio/resample.ts";
export {
	ASR_ONNX_FILE,
	asrModelFiles,
	DEFAULT_LANG,
	DEMUCS_SEGMENT_SAMPLES,
	ORIGINAL_SR,
	TARGET_SR,
} from "./constants.ts";
export type { DemucsChunkRunner } from "./separation/separate.ts";
export { separateVocalsWith } from "./separation/separate.ts";
export { tokenizeLyrics } from "./text/tokenize.ts";
export { buildVocab, type TokenizerLike } from "./text/vocab.ts";
export type { ProgressFn, ProgressStage, Vocab, Word } from "./types.ts";
export { AbortError, AlignError, throwIfAborted } from "./types.ts";

export interface AlignBuffersInput {
	/** Decoded audio at 44.1 kHz. A mono input is duplicated for Demucs. */
	stereo44k: [Float32Array, Float32Array] | [Float32Array];
	/** Plain lyric lines, one per line. */
	lyricsText: string;
	lang: Lang;
	/** Vocabulary of the acoustic model in `asr`. */
	vocab: Vocab;
	asr: AsrWindowRunner;
	/** Runs Demucs on one chunk. Absent: the mix goes straight to the acoustic model. */
	demucs?: DemucsChunkRunner;
	signal?: AbortSignal;
	onProgress?: ProgressFn;
}

export interface AlignBuffersResult {
	words: Word[];
	/** Original lyric lines (blank ones included); `Word.line` indexes this array. */
	lines: string[];
}

/**
 * separate → resample → emit → align, from decoded audio to timed words. The
 * stages and the progress events match `LyricsSync.syncFromBuffers`, except
 * that the resample is `resampleSinc` instead of ffmpeg.
 */
export async function alignBuffers(input: AlignBuffersInput): Promise<AlignBuffersResult> {
	const { signal, vocab } = input;
	const progress: ProgressFn = input.onProgress ?? (() => {});

	// Tokenize first: an unalignable lyric fails before a minute of separation.
	const tok = tokenizeLyrics(input.lyricsText, input.lang, vocab);
	if (tok.tokens.length === 0) throw new AlignError("no alignable words in the lyrics");

	throwIfAborted(signal);
	let vocals: Float32Array[] = input.stereo44k;
	if (input.demucs) {
		vocals = await separateVocalsWith(input.demucs, input.stereo44k, {
			signal,
			onProgress: (done, total) => progress("separate", done, total),
		});
	}
	// Average L and R, then resample (docs/PLAN.md §13.12).
	const vocals16k = resampleSinc(downmixToMono(vocals), ORIGINAL_SR, TARGET_SR);

	throwIfAborted(signal);
	const em = await emitWith(input.asr, vocals16k, {
		signal,
		onProgress: (done, total) => progress("emit", done, total),
	});

	throwIfAborted(signal);
	progress("align", 0, 1);
	const words = forcedAlign(em, tok, { blankId: vocab.blankId });
	progress("align", 1, 1);
	return { words, lines: tok.lines };
}
