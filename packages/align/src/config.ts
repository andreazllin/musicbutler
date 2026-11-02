/**
 * Constants for the alignment engine. See
 * docs/lyrics-sync-functionality-implementation-plan.md §5.1 and docs/PLAN.md §13.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { Lang } from "@musicbutler/shared";

export * from "./constants.ts";

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

/** One directory holds every model (docs/PLAN.md §13.14). */
export const CACHE_DIR = process.env.MUSICBUTLER_CACHE ?? join(homedir(), ".cache", "musicbutler");
/** Transformers.js cache root. Files land at `<root>/<modelId>/<file>`. */
export const TRANSFORMERS_CACHE_DIR = join(CACHE_DIR, "transformers");
