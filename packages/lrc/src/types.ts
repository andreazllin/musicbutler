/**
 * The parsed shape of an LRC file (docs/PLAN.md §5.6). Times are seconds.
 */

/** `[key:value]` with an alphabetic key. The key keeps its case; the value is trimmed. */
export type MetaTag = { key: string; value: string };

/** Enhanced LRC word timing: `<mm:ss.xx>word`. */
export type WordTime = { time: number; text: string };

/**
 * One timed lyric line. A source line with several leading timestamps becomes
 * several `Line`s that share `text`, `words` and `sourceLine`. `text` is the
 * plain lyric; when `words` is present it equals the word texts joined by one
 * space. `sourceLine` is the 0-based line index in the parsed text.
 */
export type Line = { time: number; text: string; words?: WordTime[]; sourceLine?: number };

export type LrcDocument = { meta: MetaTag[]; lines: Line[] };

/** A linter finding. `line` is 0-based; `from`/`to` are 0-based offsets into the whole text. */
export type Diagnostic = {
	severity: "error" | "warning" | "info";
	message: string;
	line: number;
	from: number;
	to: number;
};
