/**
 * Wav2Vec2 CTC emissions through Transformers.js on Node
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.5). The window
 * loop itself is in `emit.ts`, shared with the browser.
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
import { asrModelFiles, DEFAULT_LANG, MODELS, TRANSFORMERS_CACHE_DIR } from "../config.ts";
import { buildVocab } from "../text/vocab.ts";
import { type Dtype, type Emission, throwIfAborted, type Vocab } from "../types.ts";
import { type EmitOptions, emitWith } from "./emit.ts";

export { asrModelFiles } from "../config.ts";
export type { EmitOptions } from "./emit.ts";

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

	/** Runs the model over every 15 s window. See `emitWith`. */
	emit(mono16k: Float32Array, opts: EmitOptions = {}): Promise<Emission> {
		return emitWith(
			async (window) => {
				// The feature extractor applies per-window zero-mean/unit-variance normalization (do_normalize=true).
				const inputs = await this.processor(window);
				const { logits } = (await this.model(inputs)) as { logits: Tensor };
				const [, frames, classes] = logits.dims as [number, number, number];
				return {
					data: logits.data as Float32Array,
					frames,
					classes,
					dispose: () => logits.dispose(),
				};
			},
			mono16k,
			opts,
		);
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
