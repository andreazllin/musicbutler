/**
 * Timestamp parsing and formatting (docs/PLAN.md §5.6, §7.5).
 *
 * Every time is computed as an integer number of milliseconds and divided by
 * 1000 once, so `[00:12.34]` parses to exactly the double `12.34`.
 */

/**
 * `mm:ss`, `mm:ss.xx`, `mm:ss.xxx`; also `mm:ss:xx`, which §7.5 admits with
 * `[.:]`. `mm` is 1 to 3 digits and may exceed 59. Non-capturing, for
 * composition into the line (`[...]`) and word (`<...>`) forms.
 */
export const TIME_PATTERN = /\d{1,3}:\d{2}(?:[.:]\d{1,3})?/.source;

/** Capturing variant of TIME_PATTERN, anchored: minutes, seconds, fraction. */
export const TIME_PARTS_RE = /^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/;

/** A line timestamp `[mm:ss.xx]` anywhere in a string. */
export const LINE_TAG_RE = new RegExp(String.raw`\[${TIME_PATTERN}\]`);

/** A word timestamp `<mm:ss.xx>` anywhere in a string. */
export const WORD_TAG_RE = new RegExp(`<${TIME_PATTERN}>`);

/**
 * Milliseconds for the captured parts of a timestamp, or null when the seconds
 * field is 60 or more (`[99:99.99]`). The fraction is tenths, centiseconds or
 * milliseconds by digit count.
 */
export function msFromParts(mm: string, ss: string, frac: string | undefined): number | null {
	const seconds = Number(ss);
	if (seconds >= 60) return null;
	const ms = frac === undefined ? 0 : Number(frac.padEnd(3, "0"));
	return (Number(mm) * 60 + seconds) * 1000 + ms;
}

/**
 * Seconds for `mm:ss`, `mm:ss.xx`, `mm:ss.xxx` or `mm:ss:xx`. One pair of
 * surrounding `[]` or `<>` is tolerated. Returns null for anything malformed,
 * including seconds of 60 or more.
 */
export function parseTime(s: string): number | null {
	let body = s.trim();
	if (/^\[.*\]$/.test(body) || /^<.*>$/.test(body)) body = body.slice(1, -1);
	const m = TIME_PARTS_RE.exec(body);
	if (!m) return null;
	const ms = msFromParts(m[1], m[2], m[3]);
	return ms === null ? null : ms / 1000;
}

/**
 * `mm:ss.xx` (or `mm:ss.xxx`) for a non-negative millisecond count, truncated
 * to the requested precision. Minutes are zero padded to `minuteWidth` digits
 * (at least 2) and grow past that when they need to.
 */
export function formatClockMs(ms: number, fractionDigits: 2 | 3 = 2, minuteWidth = 2): string {
	const unit = fractionDigits === 3 ? 1 : 10;
	const perSecond = 1000 / unit;
	const units = Math.floor(ms / unit);
	const minutes = Math.floor(units / (60 * perSecond));
	const seconds = Math.floor(units / perSecond) % 60;
	const fraction = units % perSecond;
	const mm = String(minutes).padStart(Math.max(2, minuteWidth), "0");
	const ss = String(seconds).padStart(2, "0");
	const xx = String(fraction).padStart(fractionDigits, "0");
	return `${mm}:${ss}.${xx}`;
}

/**
 * Canonical `[mm:ss.xx]` (line) or `<mm:ss.xx>` (word). Floors to
 * centiseconds, clamps at 0, and zero pads minutes to two digits (three when
 * the value reaches 100 minutes).
 */
export function formatTime(seconds: number, kind: "line" | "word" = "line"): string {
	const ms = Number.isFinite(seconds) ? Math.round(Math.max(0, seconds) * 1000) : 0;
	const body = formatClockMs(ms);
	return kind === "word" ? `<${body}>` : `[${body}]`;
}
