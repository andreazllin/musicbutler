/**
 * Constants of the alignment engine that hold in any runtime
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.1, docs/PLAN.md §13).
 *
 * This module imports nothing from Node and reads no environment, so the
 * browser build (`browser.ts`) can use it. `config.ts` adds what depends on
 * the host: the cache directory and the environment overrides.
 */
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

export const DEFAULT_LANG: Lang = "en-US";

/** ONNX file that Transformers.js loads per dtype, relative to the model directory. */
export const ASR_ONNX_FILE: Record<"q8" | "fp32", string> = {
	q8: "onnx/model_quantized.onnx",
	fp32: "onnx/model.onnx",
};

/** Files that `from_pretrained` needs for a wav2vec2 CTC model, relative to its directory. */
export function asrModelFiles(dtype: "q8" | "fp32" = "q8"): string[] {
	return [
		"config.json",
		"preprocessor_config.json",
		"tokenizer.json",
		"tokenizer_config.json",
		ASR_ONNX_FILE[dtype],
	];
}
