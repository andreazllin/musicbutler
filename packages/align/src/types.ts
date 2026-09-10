/**
 * Shared types and error classes of the alignment engine.
 * See docs/lyrics-sync-functionality-implementation-plan.md §5.
 */
import type { Lang } from "@musicbutler/shared";

/** Log-probabilities per frame (`[frames, classes]`, row-major) plus the time of each frame. */
export interface Emission {
	logProbs: Float32Array;
	frames: number;
	classes: number;
	/** Seconds, start of each frame in the source audio. */
	frameTimes: Float32Array;
}

/** Character vocabulary of a CTC model, built from its tokenizer (§5.6). */
export interface Vocab {
	idToChar: string[];
	charToId: Map<string, number>;
	blankId: number;
	wordDelimId: number;
	unkId: number;
}

export interface SourceWord {
	/** Original spelling from the lyrics file. */
	text: string;
	/** Index into `Tokenized.lines`. */
	line: number;
	indexInLine: number;
	/** Normalized form; empty when `alignable` is false. */
	normalized: string;
	/** False when normalization left no character, e.g. for "..." or "3". */
	alignable: boolean;
}

export interface Tokenized {
	/** One token per character of the normalized string, delimiters between words. */
	tokens: Int32Array;
	/** Global word index per token, or -1 for a delimiter. */
	charToWord: Int32Array;
	words: SourceWord[];
	/** Original lines, blank ones included. */
	lines: string[];
}

export interface Trellis {
	data: Float32Array;
	/** T + 1 */
	rows: number;
	/** N + 1 */
	cols: number;
}

export interface PathPoint {
	tokenIndex: number;
	timeIndex: number;
	/** Probability in [0, 1]. */
	score: number;
}

export interface CharSegment {
	tokenIndex: number;
	startFrame: number;
	/** Exclusive. */
	endFrame: number;
	score: number;
}

export interface Word {
	/** Original spelling. */
	text: string;
	/** Seconds. */
	start: number;
	/** Seconds. */
	end: number;
	/** Mean character probability in [0, 1]; 0 for an unalignable word. */
	score: number;
	/** Index into the source `lines` array. */
	line: number;
}

export type Dtype = "q8" | "fp32";

/** Engine stage names. The server maps "emit" to its "transcribe" stage. */
export type ProgressStage = "decode" | "separate" | "emit" | "align" | "write";
export type ProgressFn = (stage: ProgressStage, done: number, total: number) => void;

export interface SyncOptions {
	lang?: Lang;
	dtype?: Dtype;
	/** Return (and, with `outDir`, write) the 16 kHz mono vocals. */
	saveVocals?: boolean;
	/** Return the 16 kHz mono vocals on the result without writing them (implied by `saveVocals`). */
	returnVocals?: boolean;
	/** When set, `sync` writes `<name>.lrc`, `<name>.words.json` and optionally `<name>.vocals.wav` here. */
	outDir?: string;
	/** ORT intra-op threads for Demucs. Default: ORT's own default. */
	threads?: number;
	/**
	 * Run Demucs vocal separation before the acoustic model (default true). False
	 * feeds the downmixed mix straight to wav2vec2 and never loads Demucs
	 * (server `isolateVocals: false`, docs/PLAN.md §6.2). A per-call option overrides it.
	 */
	separate?: boolean;
	/** Override the Demucs model path (defaults to the cache). */
	demucsModelPath?: string;
	/** Override the ASR model id or local directory (defaults to MODELS.asr[lang]). */
	asrModelId?: string;
	/** Cancels a running sync; see `AbortError`. */
	signal?: AbortSignal;
	/**
	 * Fires at every stage boundary and at least once per Demucs chunk and per
	 * ASR window (the server converts it to percentages, docs/PLAN.md §8.2).
	 */
	onProgress?: ProgressFn;
}

export interface SyncResult {
	words: Word[];
	lrc: string;
	/** Original lyric lines (blank ones included); `Word.line` indexes this array. */
	lines: string[];
	/** Present when `saveVocals` is true. Mono, 16 kHz. */
	vocals16k?: Float32Array;
}

/** Alignment failed (lyrics do not fit the audio, wrong language, ...). */
export class AlignError extends Error {
	override readonly name = "AlignError";
}

/** The caller aborted the job through an `AbortSignal`. */
export class AbortError extends Error {
	override readonly name = "AbortError";
	constructor(message = "The operation was aborted") {
		super(message);
	}
}

/** Throws `AbortError` when the signal is aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new AbortError();
}
