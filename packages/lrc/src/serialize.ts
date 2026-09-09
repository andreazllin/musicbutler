import { formatTime } from "./time.ts";
import type { LrcDocument } from "./types.ts";

/**
 * Canonical LRC output (docs/PLAN.md §5.6): the metadata block in arrival
 * order, one blank line when both metadata and lines exist, then the lines
 * sorted ascending by time (stable for ties). Line times are `[mm:ss.xx]`;
 * words are written as ` <mm:ss.xx>word`. LF line endings, no BOM, exactly one
 * trailing newline. An empty document serializes to "".
 */
export function serialize(doc: LrcDocument): string {
	const out: string[] = doc.meta.map((tag) => `[${tag.key}:${tag.value}]`);
	if (doc.meta.length > 0 && doc.lines.length > 0) out.push("");
	const sorted = [...doc.lines].sort((a, b) => a.time - b.time);
	for (const line of sorted) {
		const body =
			line.words && line.words.length > 0
				? line.words.map((w) => ` ${formatTime(w.time, "word")}${w.text}`).join("")
				: line.text;
		out.push(`${formatTime(line.time)}${body}`);
	}
	return out.length === 0 ? "" : `${out.join("\n")}\n`;
}
