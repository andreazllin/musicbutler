/**
 * AZLyrics.
 *
 * No API, no search, and the least reliable of the three. AZLyrics sits behind
 * bot protection, rate limits hard and blocks whole address ranges, so a
 * request that works from a laptop may answer 403 from a server. It is also the
 * only source here whose page states that third-party use is not allowed. Treat
 * a failure as normal: the registry keeps the other providers working.
 *
 * The lyrics sit in a `div` with no class and no id. The only thing that names
 * it is a comment inside it, so that comment is the anchor and the container is
 * the element around it.
 */
import type { LyricsCandidate, LyricsFetchResult } from "@musicbutler/shared";
import { htmlToLines } from "./html.ts";
import { fetchWithTimeout, LyricsError, type LyricsQuery, type Provider } from "./types.ts";

const ORIGIN = "https://www.azlyrics.com";
/** The comment AZLyrics puts immediately before the lyrics container. */
const LYRICS_MARKER = "Usage of azlyrics.com content by any third-party lyrics provider";

/**
 * AZLyrics has no search any more: `search.azlyrics.com` does not resolve. What
 * it still has is one address per song, built from the artist and the title with
 * every character that is not a letter or a digit removed. So this provider
 * guesses the address and asks for it: a hit is the song, and a miss is a 404.
 *
 * That is why AZLyrics finds nothing when the title in the field does not match
 * the title on the site. Correct the field and search again.
 */
export function slugify(value: string): string {
	return (
		value
			.normalize("NFD")
			// Strip the accents, because the site spells every address in plain ASCII.
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "")
	);
}

/** `https://www.azlyrics.com/lyrics/<artist>/<title>.html` */
export function songUrl(artist: string, title: string): string | null {
	// The site drops a leading "the" from the artist in most addresses.
	const artistSlug = slugify(artist.replace(/^\s*the\s+/i, ""));
	const titleSlug = slugify(title);
	if (artistSlug === "" || titleSlug === "") return null;
	return `${ORIGIN}/lyrics/${artistSlug}/${titleSlug}.html`;
}

/**
 * Inner HTML of the `div` that holds `at`, nesting aware.
 *
 * The marker comment sits inside the lyrics container, not in front of it, so
 * the opening tag is the last one before the comment and the content runs to
 * its matching close.
 */
export function divAround(html: string, at: number): string | null {
	const open = html.lastIndexOf("<div", at);
	if (open === -1) return null;
	const start = html.indexOf(">", open);
	if (start === -1 || start > at) return null;
	const boundary = /<div\b[^>]*>|<\/div\s*>/gi;
	boundary.lastIndex = start + 1;
	let depth = 1;
	for (let m = boundary.exec(html); m !== null; m = boundary.exec(html)) {
		depth += m[0].startsWith("</") ? -1 : 1;
		if (depth === 0) return html.slice(start + 1, m.index);
	}
	return null;
}

export const azlyrics: Provider = {
	id: "azlyrics",

	async search(query: LyricsQuery): Promise<LyricsCandidate[]> {
		const url = songUrl(query.artist, query.title);
		if (url === null) return [];
		const response = await fetchWithTimeout(url, {
			signal: query.signal,
			headers: { accept: "text/html" },
		});
		if (response.status === 404) return [];
		if (response.status === 403 || response.status === 429) {
			throw new LyricsError(
				"azlyrics",
				"AZLyrics refused the request. It blocks automated readers, and it often blocks servers.",
			);
		}
		if (!response.ok) {
			throw new LyricsError("azlyrics", `AZLyrics answered ${response.status} for that address.`);
		}
		return [
			{
				provider: "azlyrics",
				id: url,
				title: query.title,
				artist: query.artist,
				// AZLyrics holds words only.
				synced: false,
				url,
			},
		];
	},

	async fetch(id: string, signal?: AbortSignal): Promise<LyricsFetchResult> {
		const url = id.startsWith("http") ? id : `${ORIGIN}${id.startsWith("/") ? "" : "/"}${id}`;
		const response = await fetchWithTimeout(url, { signal, headers: { accept: "text/html" } });
		if (response.status === 403 || response.status === 429) {
			throw new LyricsError(
				"azlyrics",
				"AZLyrics refused the request. It blocks automated readers, and it often blocks servers.",
			);
		}
		if (!response.ok) {
			throw new LyricsError("azlyrics", `AZLyrics answered ${response.status} for that page.`);
		}
		const html = await response.text();
		const marker = html.indexOf(LYRICS_MARKER);
		const container = marker === -1 ? null : divAround(html, marker);
		if (container === null) {
			throw new LyricsError(
				"azlyrics",
				"The app could not find the lyrics on that AZLyrics page. AZLyrics changed the page, or it sent a block page.",
			);
		}
		const plain = htmlToLines(container);
		if (plain === "") throw new LyricsError("azlyrics", "That AZLyrics page holds no lyrics.");
		return { provider: "azlyrics", id, plain, synced: null };
	},
};
