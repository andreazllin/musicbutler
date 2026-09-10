/**
 * Wav2Vec2 CTC emissions through Transformers.js
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.5).
 *
 * Fixes two weaknesses of the original (§1): the final partial window is kept
 * (the Python `librosa.util.frame` dropped it), and frame times come from the
 * window start plus the local frame index, so the 20 ms per-window drift
 * (240 000 samples give 749 frames, not 750) is gone.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
	AutoProcessor,
	AutoTokenizer,
	env,
	type PreTrainedModel,
	type PreTrainedTokenizer,
	type Processor,
	type ProgressInfo,
	type Tensor,
	Wav2Vec2ForCTC,
} from "@huggingface/transformers";
import type { Lang } from "@musicbutler/shared";
import {
	ASR_FRAME_SAMPLES,
	ASR_FRAME_SEC,
	ASR_ONNX_FILE,
	ASR_WINDOW_SAMPLES,
	DEFAULT_LANG,
	MODELS,
	TARGET_SR,
	TRANSFORMERS_CACHE_DIR,
} from "../config.ts";
import { buildVocab } from "../text/vocab.ts";
import { type Dtype, type Emission, throwIfAborted, type Vocab } from "../types.ts";
import { logSoftmaxRows } from "./logsoftmax.ts";

/** Points the Transformers.js cache at `<CACHE_DIR>/transformers` (§5.1). Idempotent. */
export function configureTransformersEnv(): void {
	env.cacheDir = TRANSFORMERS_CACHE_DIR;
	env.allowLocalModels = true;
	env.allowRemoteModels = true;
}

export function resolveAsrModelId(lang: Lang = DEFAULT_LANG, override?: string): string {
	const id = override ?? MODELS.asr[lang];
	if (!id) {
		throw new Error(
			`No ASR model is configured for ${lang}. ` +
				(lang === "it-IT"
					? "Set MUSICBUTLER_ASR_IT to an ONNX wav2vec2 CTC model id (see packages/align/README.md)."
					: ""),
		);
	}
	return id;
}

/** Files that `from_pretrained` needs, relative to the model directory. */
export function asrModelFiles(dtype: Dtype = "q8"): string[] {
	return [
		"config.json",
		"preprocessor_config.json",
		"tokenizer.json",
		"tokenizer_config.json",
		ASR_ONNX_FILE[dtype],
	];
}

/** True when every file of the model is in the Transformers.js cache (or the id is a local directory). No network. */
export function asrModelReady(modelId: string, dtype: Dtype = "q8"): boolean {
	const dir = isAbsolute(modelId) ? modelId : join(TRANSFORMERS_CACHE_DIR, modelId);
	return asrModelFiles(dtype).every((f) => existsSync(join(dir, f)));
}

export interface Wav2Vec2LoadOptions {
	lang?: Lang;
	modelId?: string;
	dtype?: Dtype;
	progress_callback?: (info: ProgressInfo) => void;
	signal?: AbortSignal;
}

export interface EmitOptions {
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
}

export class Wav2Vec2Emitter {
	private constructor(
		readonly modelId: string,
		readonly dtype: Dtype,
		private readonly processor: Processor,
		private readonly model: PreTrainedModel,
		readonly tokenizer: PreTrainedTokenizer,
		readonly vocab: Vocab,
	) {}

	static async load(opts: Wav2Vec2LoadOptions = {}): Promise<Wav2Vec2Emitter> {
		configureTransformersEnv();
		const lang = opts.lang ?? DEFAULT_LANG;
		const modelId = resolveAsrModelId(lang, opts.modelId);
		const dtype = opts.dtype ?? "q8";
		const common = { progress_callback: opts.progress_callback };
		throwIfAborted(opts.signal);
		const processor = await AutoProcessor.from_pretrained(modelId, common);
		// AutoProcessor returns a feature extractor only (§0): load the tokenizer separately.
		const tokenizer = await AutoTokenizer.from_pretrained(modelId, common);
		throwIfAborted(opts.signal);
		const model = await Wav2Vec2ForCTC.from_pretrained(modelId, {
			...common,
			dtype,
			device: "cpu",
		});
		const vocab = buildVocab(tokenizer);
		if (modelId === MODELS.asr["en-US"]) assertEnVocab(vocab, tokenizer);
		return new Wav2Vec2Emitter(modelId, dtype, processor, model, tokenizer, vocab);
	}

	async dispose(): Promise<void> {
		await this.model.dispose();
	}

	/**
	 * Splits into 15 s windows including the final partial one (skipped only
	 * when shorter than 2 frames), runs the model per window, log-softmaxes each
	 * frame and stamps `frameTimes[f] = windowStartSec + localFrame * 0.02`.
	 */
	async emit(mono16k: Float32Array, opts: EmitOptions = {}): Promise<Emission> {
		const total = mono16k.length;
		const starts: number[] = [];
		for (let s = 0; s < total; s += ASR_WINDOW_SAMPLES) {
			if (total - s >= 2 * ASR_FRAME_SAMPLES) starts.push(s);
		}
		const parts: Float32Array[] = [];
		const times: Float32Array[] = [];
		let frames = 0;
		let classes = 0;
		opts.onProgress?.(0, starts.length);
		for (let i = 0; i < starts.length; i++) {
			throwIfAborted(opts.signal);
			const start = starts[i] as number;
			const window = mono16k.subarray(start, Math.min(start + ASR_WINDOW_SAMPLES, total));
			// The feature extractor applies per-window zero-mean/unit-variance normalization (do_normalize=true).
			const inputs = await this.processor(window);
			const { logits } = (await this.model(inputs)) as { logits: Tensor };
			const [, F, C] = logits.dims as [number, number, number];
			// Always trust logits.dims[1]; do not assume n/320 (§7.6).
			if (F > 0) {
				parts.push(logSoftmaxRows(logits.data as Float32Array, F, C));
				const t = new Float32Array(F);
				const startSec = start / TARGET_SR;
				for (let f = 0; f < F; f++) t[f] = startSec + f * ASR_FRAME_SEC;
				times.push(t);
				frames += F;
				classes = C;
			}
			logits.dispose();
			opts.onProgress?.(i + 1, starts.length);
		}
		const logProbs = new Float32Array(frames * classes);
		const frameTimes = new Float32Array(frames);
		let off = 0;
		let fOff = 0;
		for (let i = 0; i < parts.length; i++) {
			logProbs.set(parts[i] as Float32Array, off);
			frameTimes.set(times[i] as Float32Array, fOff);
			off += (parts[i] as Float32Array).length;
			fOff += (times[i] as Float32Array).length;
		}
		return { logProbs, frames, classes, frameTimes };
	}

	/** Argmax + CTC collapse, for debugging (`musicbutler-align` prints it with --verbose). */
	greedyDecode(em: Emission): string {
		const { logProbs, frames, classes } = em;
		let out = "";
		let prev = -1;
		for (let t = 0; t < frames; t++) {
			let best = 0;
			let bestV = -Infinity;
			for (let c = 0; c < classes; c++) {
				const v = logProbs[t * classes + c] as number;
				if (v > bestV) {
					bestV = v;
					best = c;
				}
			}
			if (best !== prev && best !== this.vocab.blankId) {
				out += best === this.vocab.wordDelimId ? " " : (this.vocab.idToChar[best] ?? "");
			}
			prev = best;
		}
		return out.trim();
	}
}

/** For the known en-US model, the vocabulary must match the §0 table (§7.2). */
function assertEnVocab(vocab: Vocab, tokenizer: PreTrainedTokenizer): void {
	if (vocab.idToChar[0] !== "<pad>" || vocab.blankId !== 0) {
		throw new Error(`en-US vocab: expected <pad> at 0, got ${vocab.idToChar[0]}`);
	}
	if (vocab.idToChar[4] !== "|" || vocab.wordDelimId !== 4) {
		throw new Error(`en-US vocab: expected | at 4, got ${vocab.idToChar[4]}`);
	}
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ'";
	const ids = tokenizer(letters, { add_special_tokens: false }).input_ids.data as BigInt64Array;
	for (let i = 0; i < letters.length; i++) {
		if (vocab.charToId.get(letters[i] as string) !== Number(ids[i])) {
			throw new Error(`en-US vocab: charToId disagrees with the tokenizer for ${letters[i]}`);
		}
	}
}
