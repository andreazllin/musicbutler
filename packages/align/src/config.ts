/**
 * Constants for the alignment engine. See
 * docs/lyrics-sync-functionality-implementation-plan.md §5.1 and docs/PLAN.md §13.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { Lang } from "@musicbutler/shared";

export const ORIGINAL_SR = 44100;
export const TARGET_SR = 16000;

/** 7.8 s at 44.1 kHz. The Demucs ONNX graph has a fixed input length. */
export const DEMUCS_SEGMENT_SAMPLES = 343_980;
/** 25 % overlap, as in the reference infer.py (docs/PLAN.md §13.10). */
export const DEMUCS_OVERLAP = DEMUCS_SEGMENT_SAMPLES >> 2;
/** Stem order is [drums, bass, other, vocals]. */
export const DEMUCS_VOCALS_INDEX = 3;

/** 15 s ASR windows, including the final partial one (docs/PLAN.md §13.9). */
export const ASR_WINDOW_SEC = 15;
export const ASR_WINDOW_SAMPLES = ASR_WINDOW_SEC * TARGET_SR; // 240 000
/** Total stride of the wav2vec2 convolutional frontend. Same for every variant. */
export const ASR_FRAME_SAMPLES = 320;
export const ASR_FRAME_SEC = ASR_FRAME_SAMPLES / TARGET_SR; // 0.02
/** Receptive field of the wav2vec2 frontend. frames = floor((n - 400) / 320) + 1. */
export const ASR_RECEPTIVE_FIELD = 400;

/**
 * Default ASR model ids (docs/PLAN.md §13.13). Both are ONNX exports, made with
 * `packages/align/scripts/export-asr-onnx.py`, of the PyTorch models the
 * project standardised on:
 *   en-US: facebook/wav2vec2-large-960h-lv60-self
 *   it-IT: jonatasgrosman/wav2vec2-large-xlsr-53-italian
 * `MUSICBUTLER_ASR_EN` / `MUSICBUTLER_ASR_IT` override them with another
 * Hugging Face id or the absolute path of an exported directory. An empty
 * value marks the language as "not installed".
 */
const DEFAULT_ASR_EN = "linandrea/wav2vec2-large-960h-lv60-self-onnx";
const DEFAULT_ASR_IT = "linandrea/wav2vec2-large-xlsr-53-italian-onnx";

export const MODELS = {
	demucs: {
		url: "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx",
		file: "htdemucs_fp16weights.onnx",
		/** Exact size, verified with a HEAD request (x-linked-size) on 2026-09-09. */
		bytes: 165_612_636,
	},
	asr: {
		"en-US": process.env.MUSICBUTLER_ASR_EN ?? DEFAULT_ASR_EN,
		"it-IT": process.env.MUSICBUTLER_ASR_IT ?? DEFAULT_ASR_IT,
	} satisfies Record<Lang, string>,
};

export const DEFAULT_LANG: Lang = "en-US";

/** One directory holds every model (docs/PLAN.md §13.14). */
export const CACHE_DIR = process.env.MUSICBUTLER_CACHE ?? join(homedir(), ".cache", "musicbutler");
/** Transformers.js cache root. Files land at `<root>/<modelId>/<file>`. */
export const TRANSFORMERS_CACHE_DIR = join(CACHE_DIR, "transformers");
/** ONNX file that Transformers.js loads per dtype, relative to the model directory. */
export const ASR_ONNX_FILE: Record<"q8" | "fp32", string> = {
	q8: "onnx/model_quantized.onnx",
	fp32: "onnx/model.onnx",
};
