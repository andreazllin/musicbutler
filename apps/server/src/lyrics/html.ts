/**
 * Helpers for the two providers that have no API and give back a web page.
 *
 * There is no HTML parser in this project and one lyrics container does not
 * justify the dependency: the markup we read is a run of text, `<br>` and
 * inline tags. These functions do that much and nothing else.
 */

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	// Providers write curly punctuation as entities more often than as bytes.
	rsquo: "’",
	lsquo: "‘",
	rdquo: "”",
	ldquo: "“",
	hellip: "…",
	mdash: "—",
	ndash: "–",
};

/** Resolves the named and numeric entities that show up in lyrics text. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
		if (body.startsWith("#")) {
			const hex = body[1] === "x" || body[1] === "X";
			const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
			// A code point outside Unicode would throw; leave the text as it came.
			if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
			try {
				return String.fromCodePoint(code);
			} catch {
				return whole;
			}
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
	});
}

/**
 * Turns one lyrics container into plain text: `<br>` and block ends become line
 * breaks, every other tag is dropped, and runs of blank lines collapse to one.
 */
export function htmlToLines(html: string): string {
	const text = html
		// Script, style and comments carry no words and can hold anything.
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		// Both ends of a block break the line. Dropping the opening tag would
		// join the last word before it to the first word inside it.
		.replace(/<(p|div|li)\b[^>]*>/gi, "\n")
		.replace(/<\/(p|div|li)\s*>/gi, "\n")
		.replace(/<[^>]*>/g, "");
	return decodeEntities(text)
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Every match of a tag with the given attribute, returned as inner HTML.
 * It counts nested opening tags so a container that holds another `<div>`
 * is not cut short at the first `</div>`.
 */
export function extractElements(html: string, tag: string, attribute: string): string[] {
	const out: string[] = [];
	const opener = new RegExp(`<${tag}\\b[^>]*\\b${attribute}[^>]*>`, "gi");
	const boundary = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
	for (let m = opener.exec(html); m !== null; m = opener.exec(html)) {
		const start = m.index + m[0].length;
		boundary.lastIndex = start;
		let depth = 1;
		let end = -1;
		for (let b = boundary.exec(html); b !== null; b = boundary.exec(html)) {
			depth += b[0].startsWith("</") ? -1 : 1;
			if (depth === 0) {
				end = b.index;
				break;
			}
		}
		if (end === -1) break;
		out.push(html.slice(start, end));
		opener.lastIndex = end;
	}
	return out;
}

/** Strips a leading "Artist - " or trailing " Lyrics" that page titles carry. */
export function cleanTitle(raw: string): string {
	return decodeEntities(raw)
		.replace(/\s*\|\s*Genius.*$/i, "")
		.replace(/\s+Lyrics\s*$/i, "")
		.replace(/\s+/g, " ")
		.trim();
}
