/** §5.6 tokenizer tests, driven from a fake Vocab (no model download). */
import { describe, expect, test } from "bun:test";
import { tokenizeLyrics } from "../src/text/tokenize.ts";
import { fakeVocab } from "../src/text/vocab.ts";

const EN = fakeVocab("ETAONIHSRDLUMWCFGYPBVK'XJQZ");

function decode(tokens: Int32Array, vocab = EN): string {
	return Array.from(tokens)
		.map((id) => vocab.idToChar[id] ?? "?")
		.join("");
}

describe("tokenizeLyrics en-US", () => {
	test("Hello, world! / It's ... -> HELLO|WORLD|IT'S with one unalignable word", () => {
		const tok = tokenizeLyrics("Hello, world!\n\nIt's ...", "en-US", EN);
		expect(decode(tok.tokens)).toBe("HELLO|WORLD|IT'S");
		expect(tok.lines).toEqual(["Hello, world!", "", "It's ..."]);
		expect(tok.words.map((w) => w.text)).toEqual(["Hello,", "world!", "It's", "..."]);
		expect(tok.words.map((w) => w.alignable)).toEqual([true, true, true, false]);
		expect(tok.words.map((w) => w.line)).toEqual([0, 0, 2, 2]);
		expect(tok.words.map((w) => w.indexInLine)).toEqual([0, 1, 0, 1]);
		// charToWord: one entry per token, -1 for a delimiter.
		expect(tok.charToWord.length).toBe(tok.tokens.length);
		expect(Array.from(tok.charToWord)).toEqual([0, 0, 0, 0, 0, -1, 1, 1, 1, 1, 1, -1, 2, 2, 2, 2]);
	});
	test("never emits blank, unk, <s> or </s>", () => {
		const tok = tokenizeLyrics("a1b2 c3 42 déjà", "en-US", EN);
		for (const id of tok.tokens) {
			expect(id).not.toBe(EN.blankId);
			expect(id).not.toBe(EN.unkId);
			expect(id).not.toBe(1);
			expect(id).not.toBe(2);
		}
		// en-US has no fallback map (§5.7): the vocabulary lacks É and À, so they are dropped.
		expect(decode(tok.tokens)).toBe("AB|C|DJ");
		expect(tok.words[2]?.alignable).toBe(false);
	});
	test("curly apostrophes and underscores become '", () => {
		const tok = tokenizeLyrics("don’t it_s", "en-US", EN);
		expect(decode(tok.tokens)).toBe("DON'T|IT'S");
	});
	test("no delimiter after the last word and none before the first", () => {
		const tok = tokenizeLyrics("... one two ...", "en-US", EN);
		expect(decode(tok.tokens)).toBe("ONE|TWO");
		expect(tok.words.length).toBe(4);
	});
	test("empty and whitespace-only input gives no tokens", () => {
		const tok = tokenizeLyrics("  \n\t\n", "en-US", EN);
		expect(tok.tokens.length).toBe(0);
		expect(tok.words.length).toBe(0);
		expect(tok.lines.length).toBe(3);
	});
	test("CRLF line endings split like LF", () => {
		const tok = tokenizeLyrics("one\r\ntwo", "en-US", EN);
		expect(tok.lines).toEqual(["one", "two"]);
		expect(tok.words.map((w) => w.line)).toEqual([0, 1]);
	});
	test("works with a vocabulary whose blank and delimiter are not 0 and 4", () => {
		const shifted = fakeVocab("ABCDEFGHIJKLMNOPQRSTUVWXYZ'", { specialsFirst: false });
		expect(shifted.blankId).not.toBe(0);
		expect(shifted.wordDelimId).not.toBe(4);
		const tok = tokenizeLyrics("ab cd", "en-US", shifted);
		expect(decode(tok.tokens, shifted)).toBe("AB|CD");
		expect(tok.tokens[2]).toBe(shifted.wordDelimId);
	});
});
