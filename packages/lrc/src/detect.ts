import { LINE_TAG_RE, WORD_TAG_RE } from "./time.ts";

/**
 * True when the text holds a line timestamp `[mm:ss.xx]` or a word timestamp
 * `<mm:ss.xx>` (docs/PLAN.md §7.5). A metadata tag such as `[ti:Title]` never
 * matches, because a timestamp needs digits before the colon. Malformed-but-
 * shaped tags such as `[99:99.99]` do match, per the §7.5 regex.
 */
export function hasTimestamps(text: string): boolean {
	return LINE_TAG_RE.test(text) || WORD_TAG_RE.test(text);
}
