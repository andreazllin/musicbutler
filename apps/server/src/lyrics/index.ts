/**
 * The lyrics providers, behind one call (docs/PLAN.md §6.2).
 *
 * A search asks every provider at once and waits for all of them. One source
 * being down, rate limited or blocking us is the normal case, not the
 * exception: LRCLIB is an open API, while Genius and AZLyrics are web pages
 * this app reads and may stop reading at any time. So a failure is data, not an
 * exception. The call returns whatever came back plus a note per provider that
 * did not answer, and the screen shows both.
 */
import type { LyricsCandidate, LyricsFetchResult, LyricsProvider } from "@musicbutler/shared";
import { LYRICS_PROVIDERS } from "@musicbutler/shared";
import { log } from "../log.ts";
import { azlyrics } from "./azlyrics.ts";
import { genius } from "./genius.ts";
import { lrclib } from "./lrclib.ts";
import { LyricsError, type LyricsQuery, type Provider } from "./types.ts";

const PROVIDERS: Record<LyricsProvider, Provider> = {
	lrclib,
	genius,
	azlyrics,
};

/** Preference order. LRCLIB leads because it is the only one that has timestamps. */
const ORDER: Record<LyricsProvider, number> = { lrclib: 0, genius: 1, azlyrics: 2 };

export type ProviderFailure = { provider: LyricsProvider; message: string };

export type LyricsSearchResult = {
	candidates: LyricsCandidate[];
	failures: ProviderFailure[];
};

function messageOf(provider: LyricsProvider, error: unknown): string {
	if (error instanceof LyricsError) return error.message;
	if (error instanceof Error && error.name === "AbortError") {
		return `${provider} took too long to answer.`;
	}
	return error instanceof Error ? error.message : `${provider} failed.`;
}

/** Asks every provider and merges the answers. Never throws for one bad source. */
export async function searchLyrics(query: LyricsQuery): Promise<LyricsSearchResult> {
	const settled = await Promise.allSettled(
		LYRICS_PROVIDERS.map((id) => PROVIDERS[id].search(query)),
	);

	const candidates: LyricsCandidate[] = [];
	const failures: ProviderFailure[] = [];
	settled.forEach((outcome, index) => {
		const provider = LYRICS_PROVIDERS[index] as LyricsProvider;
		if (outcome.status === "fulfilled") {
			candidates.push(...outcome.value);
			return;
		}
		const message = messageOf(provider, outcome.reason);
		log.warn(`lyrics: ${provider} search failed`, outcome.reason);
		failures.push({ provider, message });
	});

	// Timestamps first: those rows let the user skip the sync step.
	candidates.sort((a, b) => {
		if (a.synced !== b.synced) return a.synced ? -1 : 1;
		return ORDER[a.provider] - ORDER[b.provider];
	});
	return { candidates, failures };
}

/** Reads the words of one candidate. Throws `LyricsError` when the source fails. */
export function fetchLyrics(
	provider: LyricsProvider,
	id: string,
	signal?: AbortSignal,
): Promise<LyricsFetchResult> {
	return PROVIDERS[provider].fetch(id, signal);
}

export type { LyricsQuery } from "./types.ts";
export { LyricsError } from "./types.ts";
