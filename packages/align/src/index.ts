/**
 * Public API of the alignment engine
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.11, docs/PLAN.md §8).
 *
 * Server-integration additions on top of §5.11:
 *  1. `sync(audioPath, lyricsPath)` delegates to `syncText(audioPath, lyricsText, opts)`;
 *     `syncFromBuffers(stereo44k, lyricsText, opts)` skips the decode stage.
 *  2. Cancellation through `AbortSignal` (`SyncOptions.signal` or per call). It is
 *     checked between Demucs chunks, between ASR windows, before align and before
 *     write, and throws `AbortError` (name === "AbortError") leaving no partial file.
 *  3. `onProgress(stage, done, total)` fires at every stage boundary and per Demucs
 *     chunk and per ASR window. Stages: decode | separate | emit | align | write.
 *  4. `ensureModels`, `modelsReady` and `availableLangs` let the server pre-fetch
 *     weights at image build time and report `sync.languages` without downloading.
 *  5. `Word` carries `line`, `text`, `start`, `end`, `score`; `SyncResult` also
 *     returns `lines` so the caller can rebuild the LRC with another formatter.
 *  6. `threads` sets ORT `intraOpNumThreads` for Demucs.
 *  7. `separate: false` (constructor or per call) skips the Demucs stage: the mix is
 *     downmixed and resampled straight into the acoustic model, no `separate`
 *     progress events fire, and the Demucs session is never created. Both models
 *     load lazily, so this path works when the Demucs weights are absent.
 *
 * Load once and reuse: `LyricsSync.load()` holds the Demucs session (~160 MB of
 * weights, fp16 on disk) and the wav2vec2 model (~95 MB q8) in memory. A sync
 * needs about 70 MB more for a 4-minute song (trellis, §7.8) plus the decoded
 * audio (~85 MB for 4 min of stereo float32).
 */
import { basename, extname, join } from "node:path";
import { LANGS as LANG_CODES, type Lang } from "@musicbutler/shared";
import { forcedAlign } from "./align/index.ts";
import { asrModelFiles, asrModelReady, Wav2Vec2Emitter } from "./asr/wav2vec2.ts";
import { decodeToF32, resampleMono } from "./audio/ffmpeg.ts";
import { downmixToMono } from "./audio/ops.ts";
import { encodeWav16, writeWav16 } from "./audio/wav.ts";
import { CACHE_DIR, DEFAULT_LANG, MODELS, ORIGINAL_SR, TARGET_SR } from "./config.ts";
import { secondsToLrc, wordsToCsv, wordsToJson, wordsToLrc } from "./lrc/format.ts";
import { DemucsSeparator, demucsReady, ensureDemucs } from "./separation/demucs.ts";
import { tokenizeLyrics } from "./text/tokenize.ts";
import {
	AbortError,
	AlignError,
	type Dtype,
	type Emission,
	type ProgressFn,
	type ProgressStage,
	type SourceWord,
	type SyncOptions,
	type SyncResult,
	type Tokenized,
	throwIfAborted,
	type Word,
} from "./types.ts";

export { Wav2Vec2Emitter } from "./asr/wav2vec2.ts";
export type { LrcOptions } from "./lrc/format.ts";
export { DemucsSeparator } from "./separation/demucs.ts";
export type { Vocab } from "./types.ts";
export type {
	Dtype,
	Emission,
	ProgressFn,
	ProgressStage,
	SourceWord,
	SyncOptions,
	SyncResult,
	Tokenized,
	Word,
};
export {
	AbortError,
	AlignError,
	CACHE_DIR,
	DEFAULT_LANG,
	MODELS,
	secondsToLrc,
	tokenizeLyrics,
	wordsToCsv,
	wordsToJson,
	wordsToLrc,
};

/** Per-call options; each overrides the constructor value for that call. */
export interface SyncCallOptions {
	signal?: AbortSignal;
	onProgress?: ProgressFn;
	/** Run Demucs before ASR (default: the constructor value, else true). */
	separate?: boolean;
	/** Base name for the output files when `outDir` is set (default: the audio file name). */
	outName?: string;
}

export class LyricsSync {
	readonly lang: Lang;
	readonly dtype: Dtype;
	private readonly opts: SyncOptions;
	private demucs?: DemucsSeparator;
	private emitter?: Wav2Vec2Emitter;
	private demucsLoading?: Promise<DemucsSeparator>;
	private asrLoading?: Promise<Wav2Vec2Emitter>;

	constructor(opts: SyncOptions = {}) {
		this.opts = opts;
		this.lang = opts.lang ?? DEFAULT_LANG;
		this.dtype = opts.dtype ?? "q8";
	}

	/**
	 * Loads the models this instance needs (downloading them into the cache when
	 * absent): the acoustic model always, Demucs unless the constructor said
	 * `separate: false`. Idempotent and reentrant. A sync call also loads lazily,
	 * so calling this first is optional; it only moves the load time up front.
	 */
	async load(signal?: AbortSignal): Promise<void> {
		await Promise.all([
			this.ensureAsr(signal),
			this.opts.separate === false ? undefined : this.ensureDemucs(signal),
		]);
	}

	private ensureAsr(signal?: AbortSignal): Promise<Wav2Vec2Emitter> {
		this.asrLoading ??= Wav2Vec2Emitter.load({
			lang: this.lang,
			modelId: this.opts.asrModelId,
			dtype: this.dtype,
			signal,
		}).then(
			(e) => {
				this.emitter = e;
				return e;
			},
			(err) => {
				this.asrLoading = undefined;
				throw err;
			},
		);
		return this.asrLoading;
	}

	private ensureDemucs(signal?: AbortSignal): Promise<DemucsSeparator> {
		this.demucsLoading ??= DemucsSeparator.load({
			modelPath: this.opts.demucsModelPath,
			threads: this.opts.threads,
			signal,
		}).then(
			(d) => {
				this.demucs = d;
				return d;
			},
			(err) => {
				this.demucsLoading = undefined;
				throw err;
			},
		);
		return this.demucsLoading;
	}

	/** Frees the ONNX sessions. The instance cannot be used afterwards. */
	async dispose(): Promise<void> {
		await Promise.all([this.demucs?.release(), this.emitter?.dispose()]);
		this.demucs = undefined;
		this.emitter = undefined;
		this.demucsLoading = undefined;
		this.asrLoading = undefined;
	}

	get vocab() {
		return this.emitter?.vocab;
	}

	/** Reads the lyrics file and delegates to `syncText`. */
	async sync(
		audioPath: string,
		lyricsPath: string,
		call: SyncCallOptions = {},
	): Promise<SyncResult> {
		const lyricsText = await Bun.file(lyricsPath).text();
		return this.syncText(audioPath, lyricsText, call);
	}

	/** Decodes `audioPath` with ffmpeg, then runs separate → emit → align → write. */
	async syncText(
		audioPath: string,
		lyricsText: string,
		call: SyncCallOptions = {},
	): Promise<SyncResult> {
		const signal = call.signal ?? this.opts.signal;
		const progress = this.progressFn(call);
		throwIfAborted(signal);
		progress("decode", 0, 1);
		const [l, r] = await decodeToF32(audioPath, { sampleRate: ORIGINAL_SR, channels: 2 });
		throwIfAborted(signal);
		progress("decode", 1, 1);
		return this.syncFromBuffers([l as Float32Array, r as Float32Array], lyricsText, {
			...call,
			outName: call.outName ?? basename(audioPath, extname(audioPath)),
		});
	}

	/** Same as `syncText` but starts from stereo 44.1 kHz float32 buffers (no decode stage). */
	async syncFromBuffers(
		stereo44k: [Float32Array, Float32Array],
		lyricsText: string,
		call: SyncCallOptions = {},
	): Promise<SyncResult> {
		const signal = call.signal ?? this.opts.signal;
		const progress = this.progressFn(call);
		const doSeparate = call.separate ?? this.opts.separate ?? true;
		const emitter = await this.ensureAsr(signal);

		// Tokenize first: an unalignable lyric fails before a minute of separation.
		const tok = tokenizeLyrics(lyricsText, this.lang, emitter.vocab);
		if (tok.tokens.length === 0) throw new AlignError("no alignable words in the lyrics");

		throwIfAborted(signal);
		let vocals: Float32Array[] = stereo44k;
		if (doSeparate) {
			const demucs = await this.ensureDemucs(signal);
			throwIfAborted(signal);
			vocals = await demucs.separateVocals(stereo44k, {
				signal,
				onProgress: (done, total) => progress("separate", done, total),
			});
		}
		// Average L and R, then resample (docs/PLAN.md §13.12). Beats the Python left-only path.
		const vocals16k = await resampleMono(downmixToMono(vocals), ORIGINAL_SR, TARGET_SR);

		throwIfAborted(signal);
		const em = await emitter.emit(vocals16k, {
			signal,
			onProgress: (done, total) => progress("emit", done, total),
		});

		throwIfAborted(signal);
		progress("align", 0, 1);
		const words = forcedAlign(em, tok, { blankId: emitter.vocab.blankId });
		progress("align", 1, 1);

		throwIfAborted(signal);
		const lrc = wordsToLrc(words, tok.lines);
		const result: SyncResult = { words, lrc, lines: tok.lines };
		if (this.opts.saveVocals || this.opts.returnVocals) result.vocals16k = vocals16k;
		if (this.opts.outDir) {
			progress("write", 0, 1);
			const name = call.outName ?? "output";
			const dir = this.opts.outDir;
			// Every file is fully built in memory before the first write, so an abort leaves nothing partial.
			const files: Array<[string, string | Uint8Array]> = [
				[join(dir, `${name}.lrc`), lrc],
				[join(dir, `${name}.words.json`), wordsToJson(words)],
			];
			if (this.opts.saveVocals)
				files.push([join(dir, `${name}.vocals.wav`), encodeWav16([vocals16k], TARGET_SR)]);
			throwIfAborted(signal);
			for (const [path, data] of files) await Bun.write(path, data);
		}
		progress("write", 1, 1);
		return result;
	}

	/** Decodes and separates only (debugging / `separate` sub-command). Stereo 44.1 kHz vocals. */
	async separate(
		audioPath: string,
		call: SyncCallOptions = {},
	): Promise<[Float32Array, Float32Array]> {
		const signal = call.signal ?? this.opts.signal;
		const progress = this.progressFn(call);
		const demucs = await this.ensureDemucs(signal);
		progress("decode", 0, 1);
		const [l, r] = await decodeToF32(audioPath, { sampleRate: ORIGINAL_SR, channels: 2 });
		progress("decode", 1, 1);
		return demucs.separateVocals([l as Float32Array, r as Float32Array], {
			signal,
			onProgress: (done, total) => progress("separate", done, total),
		});
	}

	/** Runs the acoustic model only (debugging). */
	async emit(mono16k: Float32Array, call: SyncCallOptions = {}): Promise<Emission> {
		const signal = call.signal ?? this.opts.signal;
		const progress = this.progressFn(call);
		const emitter = await this.ensureAsr(signal);
		return emitter.emit(mono16k, {
			signal,
			onProgress: (done, total) => progress("emit", done, total),
		});
	}

	/** Argmax + CTC collapse of an emission, for debugging. */
	greedyDecode(em: Emission): string {
		if (!this.emitter) throw new Error("LyricsSync: call load() first");
		return this.emitter.greedyDecode(em);
	}

	private progressFn(call: SyncCallOptions): ProgressFn {
		const fns = [this.opts.onProgress, call.onProgress].filter(
			(f): f is ProgressFn => f !== undefined,
		);
		return (stage, done, total) => {
			for (const f of fns) f(stage, done, total);
		};
	}
}

export { writeWav16 };

/** Downloads the Demucs weights and the ASR model files for `lang` into `CACHE_DIR`. */
export async function ensureModels(
	lang: Lang,
	onProgress?: (file: string, received: number, total: number) => void,
	opts: { dtype?: Dtype; signal?: AbortSignal } = {},
): Promise<void> {
	const dtype = opts.dtype ?? "q8";
	await ensureDemucs({
		signal: opts.signal,
		onDownload: (received, total) => onProgress?.(MODELS.demucs.file, received, total),
	});
	const modelId = MODELS.asr[lang];
	if (!modelId) throw new Error(`No ASR model is configured for ${lang}`);
	if (asrModelReady(modelId, dtype)) return;
	// Transformers.js downloads into env.cacheDir as a side effect of loading.
	const emitter = await Wav2Vec2Emitter.load({
		lang,
		dtype,
		signal: opts.signal,
		progress_callback: (info) => {
			if (info.status === "progress")
				onProgress?.(`${modelId}/${info.file}`, info.loaded, info.total);
			else if (info.status === "done") onProgress?.(`${modelId}/${info.file}`, 1, 1);
		},
	});
	await emitter.dispose();
	if (!asrModelReady(modelId, dtype)) {
		throw new Error(
			`ASR model ${modelId} loaded but its files are not in ${CACHE_DIR}: expected ${asrModelFiles(dtype).join(", ")}`,
		);
	}
}

/** True when the Demucs file and every ASR model file for `lang` exist on disk. No network. */
export async function modelsReady(lang: Lang, dtype: Dtype = "q8"): Promise<boolean> {
	const modelId = MODELS.asr[lang];
	if (!modelId) return false;
	return (await demucsReady()) && asrModelReady(modelId, dtype);
}

/** `available` = the language has a model id and its files are in the cache (docs/PLAN.md §13.13). */
export async function availableLangs(
	dtype: Dtype = "q8",
): Promise<Array<{ code: Lang; available: boolean }>> {
	return Promise.all(
		LANG_CODES.map(async (code) => ({
			code,
			available: MODELS.asr[code] !== "" && (await modelsReady(code, dtype)),
		})),
	);
}
