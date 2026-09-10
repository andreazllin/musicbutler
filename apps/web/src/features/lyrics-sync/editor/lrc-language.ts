import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { Tag } from "@lezer/highlight";

/**
 * The LRC mode for CodeMirror 6 (docs/PLAN.md §7.4), written with
 * `StreamLanguage.define`. A full Lezer grammar is not worth the cost here.
 *
 * Token classes: lrc-timestamp, lrc-meta-key, lrc-meta-value, lrc-word-time,
 * lrc-text, lrc-invalid. The theme in ./theme.ts colors those classes.
 */

// A timestamp needs digits before the colon; `[ti:Title]` is metadata (docs/PLAN.md §5.6).
const LINE_TIME = /^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/;
const WORD_TIME = /^<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/;
const META_OPEN = /^\[([A-Za-z]+):/;

type State = {
	/** True until the first non-timestamp character of the line. */
	atLineStart: boolean;
	/** Set after a metadata key; the value runs to the closing bracket. */
	inMetaValue: boolean;
};

export const lrcTags = {
	timestamp: Tag.define(),
	metaKey: Tag.define(),
	metaValue: Tag.define(),
	wordTime: Tag.define(),
	text: Tag.define(),
	invalid: Tag.define(),
};

const lrcStream = StreamLanguage.define<State>({
	name: "lrc",
	startState: () => ({ atLineStart: true, inMetaValue: false }),
	token(stream, state) {
		if (stream.sol()) {
			state.atLineStart = true;
			state.inMetaValue = false;
		}

		if (state.inMetaValue) {
			if (stream.eat("]")) {
				state.inMetaValue = false;
				return "lrc-meta-key";
			}
			if (stream.skipTo("]")) return "lrc-meta-value";
			// No closing bracket on this line: the value is malformed.
			stream.skipToEnd();
			return "lrc-invalid";
		}

		if (stream.peek() === "[") {
			if (stream.match(LINE_TIME)) {
				return "lrc-timestamp";
			}
			if (state.atLineStart && stream.match(META_OPEN)) {
				state.inMetaValue = true;
				return "lrc-meta-key";
			}
			// Any other bracket is either a broken timestamp, a section marker such as
			// `[Chorus]`, or plain text. An unclosed bracket is an error; a closed one is
			// neutral text here and the linter decides whether it is malformed.
			const rest = stream.string.slice(stream.pos);
			const close = rest.indexOf("]");
			if (close === -1) {
				stream.skipToEnd();
				return "lrc-invalid";
			}
			stream.pos += close + 1;
			state.atLineStart = false;
			return "lrc-text";
		}

		if (stream.peek() === "<") {
			if (stream.match(WORD_TIME)) {
				state.atLineStart = false;
				return "lrc-word-time";
			}
			const rest = stream.string.slice(stream.pos);
			if (/^<\d/.test(rest) && !rest.includes(">")) {
				stream.skipToEnd();
				return "lrc-invalid";
			}
		}

		// Plain lyric text up to the next bracket.
		state.atLineStart = false;
		if (stream.eatWhile(/[^[<]/)) return "lrc-text";
		stream.next();
		return "lrc-text";
	},
	tokenTable: {
		"lrc-timestamp": lrcTags.timestamp,
		"lrc-meta-key": lrcTags.metaKey,
		"lrc-meta-value": lrcTags.metaValue,
		"lrc-word-time": lrcTags.wordTime,
		"lrc-text": lrcTags.text,
		"lrc-invalid": lrcTags.invalid,
	},
});

const lrcHighlight = HighlightStyle.define([
	{ tag: lrcTags.timestamp, class: "lrc-timestamp" },
	{ tag: lrcTags.metaKey, class: "lrc-meta-key" },
	{ tag: lrcTags.metaValue, class: "lrc-meta-value" },
	{ tag: lrcTags.wordTime, class: "lrc-word-time" },
	{ tag: lrcTags.text, class: "lrc-text" },
	{ tag: lrcTags.invalid, class: "lrc-invalid" },
]);

export function lrcLanguage(): Extension {
	return [lrcStream, syntaxHighlighting(lrcHighlight)];
}
