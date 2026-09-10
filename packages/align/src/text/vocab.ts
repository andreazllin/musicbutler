/**
 * Character vocabulary of a CTC model (docs/lyrics-sync-functionality-implementation-plan.md §5.6).
 * Never hard-code the blank id or the delimiter id (§7.15): they are read from the tokenizer.
 */
import type { Vocab } from "../types.ts";

/** The subset of `PreTrainedTokenizer` that `buildVocab` reads. */
export interface TokenizerLike {
	get_vocab(): Map<string, number>;
	pad_token: string | null;
	unk_token: string | null;
	_tokenizerConfig?: { word_delimiter_token?: string };
}

export interface VocabTokens {
	padToken?: string;
	unkToken?: string;
	wordDelimToken?: string;
}

/**
 * Builds a `Vocab` from a token -> id map. Special tokens (`<pad>`, `<s>`, ...)
 * and the delimiter are excluded from `charToId`, so lyrics can never emit them.
 */
export function buildVocabFromMap(map: Map<string, number>, tokens: VocabTokens = {}): Vocab {
	const padToken = tokens.padToken ?? "<pad>";
	const unkToken = tokens.unkToken ?? "<unk>";
	const wordDelimToken = tokens.wordDelimToken ?? "|";
	const blankId = map.get(padToken);
	const wordDelimId = map.get(wordDelimToken);
	const unkId = map.get(unkToken);
	if (blankId === undefined) throw new Error(`vocab: pad/blank token ${padToken} not found`);
	if (wordDelimId === undefined)
		throw new Error(`vocab: word delimiter token ${wordDelimToken} not found`);
	if (unkId === undefined) throw new Error(`vocab: unk token ${unkToken} not found`);
	let maxId = -1;
	for (const id of map.values()) if (id > maxId) maxId = id;
	const idToChar: string[] = new Array(maxId + 1).fill("");
	const charToId = new Map<string, number>();
	for (const [tok, id] of map) {
		idToChar[id] = tok;
		// Only single code points are alignable characters. This drops <pad>, <s>, </s>, <unk>.
		if (Array.from(tok).length === 1 && id !== wordDelimId && id !== blankId && id !== unkId) {
			charToId.set(tok, id);
		}
	}
	return { idToChar, charToId, blankId, wordDelimId, unkId };
}

/** Reads the id map, the pad token, the unk token and the delimiter from a Transformers.js tokenizer. */
export function buildVocab(tokenizer: TokenizerLike): Vocab {
	return buildVocabFromMap(tokenizer.get_vocab(), {
		padToken: tokenizer.pad_token ?? undefined,
		unkToken: tokenizer.unk_token ?? undefined,
		wordDelimToken: tokenizer._tokenizerConfig?.word_delimiter_token,
	});
}

/**
 * Test helper: a wav2vec2-style vocabulary `<pad> <s> </s> <unk> |` followed
 * by `chars`, with optional leading special ids to move blank/delimiter around.
 */
export function fakeVocab(chars: string, opts: { specialsFirst?: boolean } = {}): Vocab {
	const specials = ["<pad>", "<s>", "</s>", "<unk>", "|"];
	const list = opts.specialsFirst === false ? [...chars, ...specials] : [...specials, ...chars];
	const map = new Map<string, number>();
	for (let i = 0; i < list.length; i++) map.set(list[i] as string, i);
	return buildVocabFromMap(map);
}
