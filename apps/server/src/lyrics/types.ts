import type { LyricsCandidate, LyricsFetchResult, LyricsProvider } from "@musicbutler/shared";

/** What the app asks a provider to look for. */
export interface LyricsQuery {
	artist: string;
	title: string;
	album?: string;
	/** Track length in seconds. LRCLIB matches on it, so it buys an exact hit. */
	durationSec?: number;
	signal?: AbortSignal;
}

/**
 * One source of lyrics. A provider answers a search with rows that hold no
 * words, then returns the words for one row. Both calls may fail: a source can
 * be down, rate limited or blocking us, and one dead source must not stop the
 * others.
 */
export interface Provider {
	readonly id: LyricsProvider;
	search(query: LyricsQuery): Promise<LyricsCandidate[]>;
	fetch(id: string, signal?: AbortSignal): Promise<LyricsFetchResult>;
}

/** A provider failure the user can read. */
export class LyricsError extends Error {
	override name = "LyricsError";
	constructor(
		readonly provider: LyricsProvider,
		message: string,
	) {
		super(message);
	}
}

/** Seconds to wait on one provider before giving up on it. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/**
 * Sent on every outbound request. LRCLIB asks for a name and a link, and the
 * two scraped sites are likelier to answer a request that says who it is.
 */
export const USER_AGENT = "musicbutler (https://github.com/andreazllin/musicbutler)";

/** Fetch with a timeout, so one slow source cannot hold the whole search. */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit & { signal?: AbortSignal } = {},
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	init.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		return await fetch(url, {
			...init,
			signal: controller.signal,
			headers: { "user-agent": USER_AGENT, ...init.headers },
		});
	} finally {
		clearTimeout(timer);
		init.signal?.removeEventListener("abort", onAbort);
	}
}
