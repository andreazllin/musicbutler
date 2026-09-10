/**
 * LRC / JSON / CSV output (docs/lyrics-sync-functionality-implementation-plan.md §5.10).
 */
import type { Word } from "../types.ts";

/** "[mm:ss.xx]" or "<mm:ss.xx>", hundredths floored, clamped at 0. */
export function secondsToLrc(s: number, kind: "line" | "word"): string {
	const total = Math.max(0, Number.isFinite(s) ? s : 0);
	const hundredths = Math.floor(total * 100 + 1e-6);
	const mm = Math.floor(hundredths / 6000);
	const ss = Math.floor((hundredths % 6000) / 100);
	const xx = hundredths % 100;
	const body = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(xx).padStart(2, "0")}`;
	return kind === "line" ? `[${body}]` : `<${body}>`;
}

export interface LrcOptions {
	/** "first-word" (default): line tag = start of its first word. "prev-end": end of the previous word, as the original. */
	lineTagMode?: "first-word" | "prev-end";
	/** "none" (default): `<tag>word`. "original": `<tag> word` with the Python spacing. */
	spacing?: "none" | "original";
	headers?: { ti?: string; ar?: string; length?: number; re?: string };
}

/**
 * Walks `lines`, skips blank ones, writes `[mm:ss.xx]` then one `<mm:ss.xx>word`
 * per word with its original spelling. `words[i].line` links a word to its line.
 */
export function wordsToLrc(words: Word[], lines: string[], opts: LrcOptions = {}): string {
	const mode = opts.lineTagMode ?? "first-word";
	const spacing = opts.spacing ?? "none";
	const byLine = new Map<number, Word[]>();
	for (const w of words) {
		const arr = byLine.get(w.line);
		if (arr) arr.push(w);
		else byLine.set(w.line, [w]);
	}
	const out: string[] = [];
	if (opts.headers) {
		const h = opts.headers;
		if (h.ti !== undefined) out.push(`[ti:${h.ti}]`);
		if (h.ar !== undefined) out.push(`[ar:${h.ar}]`);
		out.push(`[re:${h.re ?? "musicbutler"}]`);
		if (h.length !== undefined) out.push(`[length:${secondsToLrc(h.length, "line").slice(1, 6)}]`);
	}
	let prevEnd = 0;
	for (let li = 0; li < lines.length; li++) {
		const lineWords = byLine.get(li);
		if (!lineWords || lineWords.length === 0) continue; // blank line (fix for the original's indexing bug)
		const tagTime = mode === "first-word" ? (lineWords[0] as Word).start : prevEnd;
		let line = secondsToLrc(tagTime, "line");
		lineWords.forEach((w, i) => {
			const tag = secondsToLrc(w.start, "word");
			if (spacing === "original") line += ` ${tag} ${w.text}`;
			else line += `${i === 0 ? "" : " "}${tag}${w.text}`;
			prevEnd = w.end;
		});
		out.push(line);
	}
	return `${out.join("\n")}\n`;
}

export function wordsToJson(words: Word[]): string {
	return `${JSON.stringify(words, null, 2)}\n`;
}

function csvCell(s: string): string {
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Matches the Python `words/*.csv` output: columns `label,start,end`. */
export function wordsToCsv(words: Word[]): string {
	const rows = ["label,start,end"];
	for (const w of words) rows.push(`${csvCell(w.text)},${w.start.toFixed(3)},${w.end.toFixed(3)}`);
	return `${rows.join("\n")}\n`;
}
