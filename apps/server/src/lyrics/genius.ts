/**
 * Genius.
 *
 * Genius has no lyrics endpoint. Its API returns metadata and a link, so the
 * words can only come from the song page. That means this provider reads HTML
 * and breaks whenever Genius changes the markup, which is why every step here
 * fails into a readable message rather than an exception the user cannot act on.
 *
 * Search goes through the site's own JSON endpoint, which needs no token. The
 * candidate id is the song path, because fetching by numeric id would need the
 * API key that this provider is built to avoid.
 */
import type { LyricsCandidate, LyricsFetchResult } from "@musicbutler/shared";
import { LYRICS_SEARCH_LIMIT } from "@musicbutler/shared";
import { cleanTitle, extractElements, htmlToLines } from "./html.ts";
import { fetchWithTimeout, LyricsError, type LyricsQuery, type Provider } from "./types.ts";

const ORIGIN = "https://genius.com";

type GeniusHit = {
	result?: {
		title?: string | null;
		title_with_featured?: string | null;
		url?: string | null;
		path?: string | null;
		primary_artist?: { name?: string | null } | null;
	} | null;
};

/** Walks the search payload, whose shape differs between the `multi` and `song` endpoints. */
function collectHits(payload: unknown): GeniusHit[] {
	const response = (payload as { response?: { sections?: unknown; hits?: unknown } })?.response;
	if (!response) return [];
	if (Array.isArray(response.hits)) return response.hits as GeniusHit[];
	if (!Array.isArray(response.sections)) return [];
	const out: GeniusHit[] = [];
	for (const section of response.sections as { type?: string; hits?: unknown }[]) {
		if (section.type !== undefined && section.type !== "song") continue;
		if (Array.isArray(section.hits)) out.push(...(section.hits as GeniusHit[]));
	}
	return out;
}

export const genius: Provider = {
	id: "genius",

	async search(query: LyricsQuery): Promise<LyricsCandidate[]> {
		const url = new URL(`${ORIGIN}/api/search/multi`);
		url.searchParams.set("q", `${query.artist} ${query.title}`.trim());
		const response = await fetchWithTimeout(url.toString(), { signal: query.signal });
		if (!response.ok) {
			throw new LyricsError("genius", `Genius answered ${response.status} to the search.`);
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw new LyricsError("genius", "Genius sent an answer this app cannot read.");
		}

		const out: LyricsCandidate[] = [];
		const seen = new Set<string>();
		for (const hit of collectHits(payload)) {
			const result = hit.result;
			if (!result) continue;
			const path = result.path ?? (result.url ? new URL(result.url).pathname : null);
			if (!path || seen.has(path)) continue;
			seen.add(path);
			out.push({
				provider: "genius",
				id: path,
				title: cleanTitle(result.title_with_featured || result.title || "Unknown title"),
				artist: cleanTitle(result.primary_artist?.name || "Unknown artist"),
				// Genius holds words only. The sync step still has to run.
				synced: false,
				url: result.url ?? `${ORIGIN}${path}`,
			});
			if (out.length >= LYRICS_SEARCH_LIMIT) break;
		}
		return out;
	},

	async fetch(id: string, signal?: AbortSignal): Promise<LyricsFetchResult> {
		const url = id.startsWith("http") ? id : `${ORIGIN}${id.startsWith("/") ? "" : "/"}${id}`;
		const response = await fetchWithTimeout(url, {
			signal,
			headers: { accept: "text/html" },
		});
		if (!response.ok) {
			throw new LyricsError("genius", `Genius answered ${response.status} for that song page.`);
		}
		const html = await response.text();
		const containers = extractElements(html, "div", "data-lyrics-container");
		if (containers.length === 0) {
			throw new LyricsError(
				"genius",
				"The app could not find the lyrics on that Genius page. Genius changed the page, or the page holds no lyrics.",
			);
		}
		const plain = stripSectionHeaders(containers.map(htmlToLines).join("\n"));
		if (plain === "") throw new LyricsError("genius", "That Genius page holds no lyrics.");
		return { provider: "genius", id, plain, synced: null };
	},
};

/**
 * Drops the `[Verse 1]` and `[Chorus]` labels Genius writes between sections.
 * They are not sung, and a line in square brackets is exactly what the LRC
 * parser reads as a timestamp or a metadata tag.
 */
export function stripSectionHeaders(text: string): string {
	return text
		.split("\n")
		.filter((line) => !/^\s*\[[^\]]*\]\s*$/.test(line))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
