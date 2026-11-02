/**
 * The language seam (docs/lyrics-sync-functionality-implementation-plan.md §5.7).
 * Everything about the text that depends on the language lives here. The model
 * id per language lives in `config.ts`, because the host picks it.
 */
import type { Lang } from "@musicbutler/shared";
import type { Vocab } from "../types.ts";
import { IT_FALLBACK, normalizeWordEn, normalizeWordIt } from "./normalize.ts";

export interface LangSpec {
	normalize(word: string, vocab: Vocab): string;
	/** Applied only when the model vocabulary lacks the character. */
	fallback: Record<string, string>;
}

export const LANGS: Record<Lang, LangSpec> = {
	"en-US": { normalize: normalizeWordEn, fallback: {} },
	"it-IT": { normalize: normalizeWordIt, fallback: IT_FALLBACK },
};
