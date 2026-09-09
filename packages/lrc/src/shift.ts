import { formatClockMs, msFromParts } from "./time.ts";

const ANY_TAG_G = /([[<])(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?([\]>])/g;

/**
 * Shifts every line and word timestamp in the text by `offsetSeconds`,
 * clamping at 0 (docs/PLAN.md §7.6 "Apply offset to document"). This is a
 * text-level edit, not a reparse: metadata, blank lines, untimed lines,
 * spacing and CRLF line endings survive byte for byte, so the editor's undo
 * reverses it in one step.
 *
 * Only the matched tags change. A tag keeps its minute width and keeps three
 * fraction digits when it had them; otherwise it is written as `mm:ss.xx`.
 * Malformed tags (seconds of 60 or more) and mismatched brackets are left as
 * they are.
 */
export function shiftTimestamps(text: string, offsetSeconds: number): string {
	const deltaMs = Math.round(offsetSeconds * 1000);
	return text.replace(
		ANY_TAG_G,
		(match: string, open: string, mm: string, ss: string, frac: string | undefined, close) => {
			if ((open === "[") !== (close === "]")) return match;
			const ms = msFromParts(mm, ss, frac);
			if (ms === null) return match;
			const digits = frac?.length === 3 ? 3 : 2;
			return `${open}${formatClockMs(Math.max(0, ms + deltaMs), digits, mm.length)}${close}`;
		},
	);
}
