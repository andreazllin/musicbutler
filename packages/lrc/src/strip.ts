import { collapseWhitespace, stripBom } from "./parse.ts";
import { TIME_PATTERN } from "./time.ts";

const ANY_TAG_G = new RegExp(String.raw`\[${TIME_PATTERN}\]|<${TIME_PATTERN}>`, "g");
/** A line that is one bracket group: metadata `[ti:Title]` or a section marker `[Chorus]`. */
const BRACKET_ONLY_RE = /^\[[^[\]]*\]$/;

/**
 * The lyric source for the sync engine (docs/PLAN.md §8.2 rule 1): every line
 * and word timestamp is removed, then metadata tags, blank lines and bracketed
 * section markers such as `[Chorus]` or `[Verse 1]` are dropped. Each returned
 * line is trimmed with internal whitespace collapsed.
 */
export function stripToPlainLyrics(text: string): string[] {
	const out: string[] = [];
	for (const rawLine of stripBom(text).split(/\r?\n/)) {
		const line = collapseWhitespace(rawLine.replace(ANY_TAG_G, ""));
		if (line === "" || BRACKET_ONLY_RE.test(line)) continue;
		out.push(line);
	}
	return out;
}
