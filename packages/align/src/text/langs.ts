/**
 * The language seam (docs/lyrics-sync-functionality-implementation-plan.md §5.7).
 * Everything that depends on the language lives here.
 */
import type { Lang } from "@musicbutler/shared";
import { MODELS } from "../config.ts";
import type { Vocab } from "../types.ts";
import { IT_FALLBACK, normalizeWordEn, normalizeWordIt } from "./normalize.ts";

export interface LangSpec {
	modelId: string;
	normalize(word: string, vocab: Vocab): string;
	/** Applied only when the model vocabulary lacks the character. */
	fallback: Record<string, string>;
}

export const LANGS: Record<Lang, LangSpec> = {
	"en-US": { modelId: MODELS.asr["en-US"], normalize: normalizeWordEn, fallback: {} },
	"it-IT": { modelId: MODELS.asr["it-IT"], normalize: normalizeWordIt, fallback: IT_FALLBACK },
};
