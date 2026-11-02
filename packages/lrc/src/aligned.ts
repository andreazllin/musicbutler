/**
 * The write stage of a sync (docs/PLAN.md §8.2 rule 2): from aligned words to
 * an LRC document. The server and the browser both finish a sync here, so a
 * song gets the same file whichever of them ran the alignment.
 */
import { parse } from "./parse.ts";
import type { Line, LrcDocument } from "./types.ts";

/** One word the aligner timed. `line` indexes the `lines` it was given. */
export type AlignedWord = { text: string; start: number; end: number; line: number };

export type AlignedDocumentOptions = {
	/** Seconds the line tags move earlier than the first word. */
	leadIn: number;
	/** Write a `<mm:ss.xx>` tag per word (enhanced LRC). */
	wordTimestamps: boolean;
};

/**
 * One timed line per source line that holds words, line time = first word
 * start minus `leadIn` (clamped at 0), optional word tags, and the metadata
 * tags of the editor text kept.
 */
export function buildAlignedDocument(
	editorText: string,
	lines: string[],
	words: AlignedWord[],
	opts: AlignedDocumentOptions,
): LrcDocument {
	const byLine = new Map<number, AlignedWord[]>();
	for (const w of words) {
		const list = byLine.get(w.line);
		if (list) list.push(w);
		else byLine.set(w.line, [w]);
	}
	const shift = (t: number) => Math.max(0, t - opts.leadIn);
	const timed: Line[] = [];
	for (const [index, lineWords] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
		const first = lineWords[0];
		if (!first) continue;
		const line: Line = {
			time: shift(first.start),
			text: lines[index] ?? lineWords.map((w) => w.text).join(" "),
		};
		if (opts.wordTimestamps)
			line.words = lineWords.map((w) => ({ time: shift(w.start), text: w.text }));
		timed.push(line);
	}
	return { meta: parse(editorText).meta, lines: timed };
}
