/**
 * Per-language word normalizers (docs/lyrics-sync-functionality-implementation-plan.md §5.7).
 *
 * Shared rules: NFKC, curly apostrophes and `_` become `'`, then case folding,
 * then every character that the vocabulary lacks is dropped. The vocabulary
 * decides the final character set, not a regular expression.
 *
 * Case: the spec says "upper case". `Xenova/wav2vec2-base-960h` is upper case,
 * but Italian CTC exports (e.g. jonatasgrosman/wav2vec2-large-xlsr-53-italian)
 * hold lower-case letters only. `caseFor` therefore follows the vocabulary:
 * upper case when it holds "A", lower case when it holds "a" instead.
 */
import type { Vocab } from "../types.ts";

export function caseFor(vocab: Vocab): "upper" | "lower" {
	if (vocab.charToId.has("A")) return "upper";
	if (vocab.charToId.has("a")) return "lower";
	return "upper";
}

export function normalizeShared(word: string, vocab: Vocab): string {
	const s = word.normalize("NFKC").replace(/[’‘ʼ]/g, "'").replace(/_/g, "'");
	return caseFor(vocab) === "lower" ? s.toLowerCase() : s.toUpperCase();
}

function keepKnown(chars: string[], vocab: Vocab): string {
	let out = "";
	for (const ch of chars) if (vocab.charToId.has(ch)) out += ch;
	return out;
}

/** en-US: shared rules, then the vocabulary filter. Keeps the apostrophe (§7.11). */
export function normalizeWordEn(word: string, vocab: Vocab): string {
	return keepKnown(Array.from(normalizeShared(word, vocab)), vocab);
}

/** Accented vowel -> plain vowel, applied only when the vocabulary lacks the accented letter (§7.16). */
export const IT_FALLBACK: Record<string, string> = {
	À: "A",
	Á: "A",
	Â: "A",
	È: "E",
	É: "E",
	Ê: "E",
	Ì: "I",
	Í: "I",
	Î: "I",
	Ò: "O",
	Ó: "O",
	Ô: "O",
	Ù: "U",
	Ú: "U",
	Û: "U",
	à: "a",
	á: "a",
	â: "a",
	è: "e",
	é: "e",
	ê: "e",
	ì: "i",
	í: "i",
	î: "i",
	ò: "o",
	ó: "o",
	ô: "o",
	ù: "u",
	ú: "u",
	û: "u",
};

/**
 * it-IT: shared rules, then the fallback map for characters the vocabulary
 * lacks, then the vocabulary filter. Apostrophes stay: elisions such as
 * `l'amore` and `c'è` are one spoken unit, and `po'` keeps its trailing one.
 */
export function normalizeWordIt(word: string, vocab: Vocab): string {
	const chars = Array.from(normalizeShared(word, vocab)).map((ch) => {
		if (vocab.charToId.has(ch)) return ch;
		return IT_FALLBACK[ch] ?? ch;
	});
	return keepKnown(chars, vocab);
}
