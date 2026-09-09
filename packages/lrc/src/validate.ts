import { LEADING_TAGS_RE } from "./parse.ts";
import { formatClockMs, msFromParts, TIME_PARTS_RE } from "./time.ts";
import type { Diagnostic } from "./types.ts";

/** Digits, colon, digits: shaped like a timestamp, even when malformed. */
const TIME_SHAPE_RE = /^\d+:\d+(?:[.:]\d+)?$/;
/** The start of a timestamp right after an opener. */
const TIME_START_RE = /^\d{1,3}:/;

/**
 * Diagnostics for the editor linter (docs/PLAN.md §7.4):
 *
 * - error: a malformed timestamp such as `[1:2]`, `[99:99.99]` (seconds of 60
 *   or more), or an unclosed `[00:12.3` / `<00:12`;
 * - warning: a line timestamp earlier than the previous timed line. A line
 *   with several tags (a repeated lyric) is positioned by its earliest tag,
 *   and its tags are not compared with each other;
 * - warning: a timestamp past `durationSeconds`, when given;
 * - info: a line timestamp equal to one seen before.
 *
 * Untimed lines are not reported: plain lyrics pasted before a sync are the
 * normal input, and lighting them all up would bury the real findings.
 */
export function validate(text: string, opts: { durationSeconds?: number } = {}): Diagnostic[] {
	const out: Diagnostic[] = [];
	const seen = new Set<number>();
	let prevLineMinMs: number | null = null;
	let offset = 0;

	text.split("\n").forEach((rawLine, lineNo) => {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		const lead = LEADING_TAGS_RE.exec(line);
		const leadingEnd = lead ? lead[0].length : 0;
		let lineMinMs: number | null = null;

		const push = (severity: Diagnostic["severity"], message: string, from: number, to: number) =>
			out.push({ severity, message, line: lineNo, from: offset + from, to: offset + to });

		let pos = 0;
		while (pos < line.length) {
			const idx = nextOpener(line, pos);
			if (idx === -1) break;
			const open = line[idx];
			const close = open === "[" ? "]" : ">";
			const closeIdx = line.indexOf(close, idx + 1);
			const nextOpen = line.indexOf(open, idx + 1);
			if (closeIdx === -1 || (nextOpen !== -1 && nextOpen < closeIdx)) {
				if (TIME_START_RE.test(line.slice(idx + 1))) {
					const end = nextOpen === -1 ? line.length : nextOpen;
					push("error", `Unclosed timestamp "${line.slice(idx, end).trimEnd()}"`, idx, end);
				}
				pos = idx + 1;
				continue;
			}
			pos = closeIdx + 1;

			const content = line.slice(idx + 1, closeIdx);
			const tag = line.slice(idx, pos);
			const parts = TIME_PARTS_RE.exec(content);
			if (!parts) {
				if (TIME_SHAPE_RE.test(content)) {
					const expected = open === "[" ? "[mm:ss.xx]" : "<mm:ss.xx>";
					push("error", `Malformed timestamp "${tag}": expected ${expected}`, idx, pos);
				}
				// Metadata, section markers and stray text such as `<3` are not timestamps.
				continue;
			}
			const ms = msFromParts(parts[1], parts[2], parts[3]);
			if (ms === null) {
				push("error", `Invalid timestamp "${tag}": seconds must be below 60`, idx, pos);
				continue;
			}
			if (opts.durationSeconds !== undefined && ms / 1000 > opts.durationSeconds) {
				const end = formatClockMs(Math.round(opts.durationSeconds * 1000));
				push("warning", `Timestamp ${tag} is past the end of the audio (${end})`, idx, pos);
			}
			// Only leading `[...]` tags time the line; anywhere else the parser reads them as text.
			if (open !== "[" || idx >= leadingEnd) continue;
			if (prevLineMinMs !== null && ms < prevLineMinMs) {
				const prev = formatClockMs(prevLineMinMs);
				push("warning", `Timestamp ${tag} is earlier than the previous line (${prev})`, idx, pos);
			}
			if (seen.has(ms)) push("info", `Duplicate timestamp ${tag}`, idx, pos);
			seen.add(ms);
			lineMinMs = lineMinMs === null ? ms : Math.min(lineMinMs, ms);
		}

		if (lineMinMs !== null) prevLineMinMs = lineMinMs;
		offset += rawLine.length + 1;
	});
	return out;
}

function nextOpener(line: string, from: number): number {
	const a = line.indexOf("[", from);
	const b = line.indexOf("<", from);
	if (a === -1) return b;
	if (b === -1) return a;
	return Math.min(a, b);
}
