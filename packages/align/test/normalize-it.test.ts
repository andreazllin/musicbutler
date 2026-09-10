/** §5.7 Italian normalizer: the five cases, with and without accented vowels in the vocab. */
import { describe, expect, test } from "bun:test";
import { normalizeWordIt } from "../src/text/normalize.ts";
import { tokenizeLyrics } from "../src/text/tokenize.ts";
import { fakeVocab } from "../src/text/vocab.ts";

const PLAIN = fakeVocab("ABCDEFGHIJKLMNOPQRSTUVWXYZ'");
const ACCENTED = fakeVocab("ABCDEFGHIJKLMNOPQRSTUVWXYZ'ÀÈÉÌÒÙ");
const LOWER = fakeVocab("abcdefghijklmnopqrstuvwxyz'àèéìòù");

describe("normalizeWordIt", () => {
	test("1. L'amore stays one word with its apostrophe", () => {
		expect(normalizeWordIt("L'amore", PLAIN)).toBe("L'AMORE");
		expect(normalizeWordIt("L’amore", ACCENTED)).toBe("L'AMORE");
		const tok = tokenizeLyrics("L'amore", "it-IT", PLAIN);
		expect(tok.words.length).toBe(1);
		expect(tok.words[0]?.alignable).toBe(true);
		expect(tok.tokens.length).toBe(7);
	});
	test("2. perché folds to PERCHE only when the vocabulary lacks É", () => {
		expect(normalizeWordIt("perché", PLAIN)).toBe("PERCHE");
		expect(normalizeWordIt("perché", ACCENTED)).toBe("PERCHÉ");
	});
	test("3. un po' gives two words and the second keeps its trailing apostrophe", () => {
		const tok = tokenizeLyrics("un po'", "it-IT", PLAIN);
		expect(tok.words.map((w) => w.normalized)).toEqual(["UN", "PO'"]);
		expect(tok.words.every((w) => w.alignable)).toBe(true);
	});
	test("4. città folds to CITTA or keeps CITTÀ by the same rule", () => {
		expect(normalizeWordIt("città", PLAIN)).toBe("CITTA");
		expect(normalizeWordIt("città", ACCENTED)).toBe("CITTÀ");
	});
	test("5. a digit normalizes to the empty string, so the word is unalignable", () => {
		expect(normalizeWordIt("3", PLAIN)).toBe("");
		expect(normalizeWordIt("3", ACCENTED)).toBe("");
		const tok = tokenizeLyrics("3", "it-IT", PLAIN);
		expect(tok.words[0]?.alignable).toBe(false);
		expect(tok.tokens.length).toBe(0);
	});
	test("follows a lower-case vocabulary (Italian CTC exports are lower case)", () => {
		expect(normalizeWordIt("Perché", LOWER)).toBe("perché");
		expect(normalizeWordIt("CITTÀ", LOWER)).toBe("città");
		expect(normalizeWordIt("c'è", LOWER)).toBe("c'è");
	});
	test("other elisions stay one unit", () => {
		for (const w of ["un'altra", "dell'acqua", "c'è"]) {
			const n = normalizeWordIt(w, ACCENTED);
			expect(n.includes("'")).toBe(true);
			expect(n.length).toBe(w.length);
		}
	});
	test("NFKC composes decomposed accents before the fallback", () => {
		// "e" + combining acute -> "é" -> É -> E (plain vocab)
		expect(normalizeWordIt("perché", PLAIN)).toBe("PERCHE");
		expect(normalizeWordIt("perché", ACCENTED)).toBe("PERCHÉ");
	});
});
