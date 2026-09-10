/**
 * Lyrics -> one token per character of the normalized text
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.6).
 *
 * Invariant: `tokens.length === charToWord.length`; every token maps to a
 * source word index or to -1 for a delimiter. `unkId`, `<s>` and `</s>` are
 * never emitted (fixes the original's `<unk>` failure mode, §1).
 */
import type { Lang } from "@musicbutler/shared";
import type { SourceWord, Tokenized, Vocab } from "../types.ts";
import { LANGS } from "./langs.ts";

export function tokenizeLyrics(rawText: string, lang: Lang, vocab: Vocab): Tokenized {
	const spec = LANGS[lang];
	const lines = rawText.split(/\r?\n/);
	const words: SourceWord[] = [];
	for (let li = 0; li < lines.length; li++) {
		const parts = (lines[li] as string).trim().split(/\s+/);
		let idx = 0;
		for (const text of parts) {
			if (text === "") continue;
			const normalized = spec.normalize(text, vocab);
			words.push({ text, line: li, indexInLine: idx++, normalized, alignable: normalized !== "" });
		}
	}
	const tokenList: number[] = [];
	const wordList: number[] = [];
	let first = true;
	for (let wi = 0; wi < words.length; wi++) {
		const w = words[wi] as SourceWord;
		if (!w.alignable) continue;
		if (!first) {
			tokenList.push(vocab.wordDelimId);
			wordList.push(-1);
		}
		first = false;
		for (const ch of Array.from(w.normalized)) {
			const id = vocab.charToId.get(ch);
			// normalize() already dropped unknown characters; this guards the invariant.
			if (id === undefined || id === vocab.unkId) continue;
			tokenList.push(id);
			wordList.push(wi);
		}
	}
	return {
		tokens: Int32Array.from(tokenList),
		charToWord: Int32Array.from(wordList),
		words,
		lines,
	};
}
