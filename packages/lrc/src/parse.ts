import { msFromParts, TIME_PATTERN } from "./time.ts";
import type { Line, LrcDocument, MetaTag, WordTime } from "./types.ts";

/** One or more leading `[mm:ss.xx]` tags, each optionally preceded by whitespace. */
export const LEADING_TAGS_RE = new RegExp(String.raw`^(?:\s*\[${TIME_PATTERN}\])+`);
const LINE_TAG_PARTS_G = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG_PARTS_G = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
/** `[key:value]` with an alphabetic key. Digits before the colon make it a timestamp instead. */
const META_RE = /^\s*\[([A-Za-z]+):(.*)\]\s*$/;

/** Trims and collapses internal whitespace runs to one space. */
export function collapseWhitespace(s: string): string {
	return s.trim().split(/\s+/).join(" ");
}

export function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parses LRC text (docs/PLAN.md §5.6). Accepts LF or CRLF, a missing trailing
 * newline, a BOM and the empty string.
 *
 * `lines` keeps document order; `serialize` sorts. A source line with several
 * leading timestamps expands into one `Line` per timestamp.
 *
 * Lines that are neither timed nor metadata (blank lines, plain lyrics,
 * section markers such as `[Chorus]`, malformed tags such as `[1:2]` or
 * `[99:99.99]`) are dropped from `lines`: a `Line` needs a time, and the
 * editor never round-trips through this structure. `validate` and
 * `stripToPlainLyrics` work on the text, so nothing is lost for them.
 *
 * An `[offset:...]` tag is kept as metadata and not applied to the times.
 */
export function parse(text: string): LrcDocument {
	const meta: MetaTag[] = [];
	const lines: Line[] = [];
	stripBom(text)
		.split(/\r?\n/)
		.forEach((rawLine, sourceLine) => {
			const lead = LEADING_TAGS_RE.exec(rawLine);
			if (lead) {
				const times = lineTimes(lead[0]);
				// Every leading tag had seconds >= 60: nothing to anchor the line to.
				if (times.length === 0) return;
				const body = parseBody(rawLine.slice(lead[0].length), times[0]);
				for (const time of times) {
					const line: Line = { time, text: body.text, sourceLine };
					if (body.words) line.words = body.words.map((w) => ({ ...w }));
					lines.push(line);
				}
				return;
			}
			const m = META_RE.exec(rawLine);
			if (m) meta.push({ key: m[1], value: m[2].trim() });
		});
	return { meta, lines };
}

/** Seconds for each well-formed tag in a run of leading `[mm:ss.xx]` tags. */
function lineTimes(leading: string): number[] {
	const times: number[] = [];
	for (const m of leading.matchAll(LINE_TAG_PARTS_G)) {
		const ms = msFromParts(m[1], m[2], m[3]);
		if (ms !== null) times.push(ms / 1000);
	}
	return times;
}

/**
 * The text after the leading tags. With no word tags the whole remainder is
 * the text. With word tags, each tag owns the text up to the next tag (both
 * `<tag>word` and `<tag> word`). Text before the first word tag becomes a word
 * timed at the line time, so that `text` always equals the joined words and
 * the round trip loses nothing.
 */
function parseBody(rest: string, lineTime: number): { text: string; words?: WordTime[] } {
	const tags: { start: number; end: number; time: number }[] = [];
	for (const m of rest.matchAll(WORD_TAG_PARTS_G)) {
		const ms = msFromParts(m[1], m[2], m[3]);
		if (ms !== null) tags.push({ start: m.index, end: m.index + m[0].length, time: ms / 1000 });
	}
	if (tags.length === 0) return { text: collapseWhitespace(rest) };

	const words: WordTime[] = [];
	const prefix = collapseWhitespace(rest.slice(0, tags[0].start));
	if (prefix) words.push({ time: lineTime, text: prefix });
	tags.forEach((tag, i) => {
		const next = tags[i + 1];
		const text = collapseWhitespace(rest.slice(tag.end, next ? next.start : rest.length));
		words.push({ time: tag.time, text });
	});
	const text = words
		.map((w) => w.text)
		.filter(Boolean)
		.join(" ");
	return { text, words };
}
