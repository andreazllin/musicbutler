/**
 * LRCLIB (https://lrclib.net/docs).
 *
 * The only source here with an API meant to be called: no key, documented, and
 * it holds timestamps. A hit with `syncedLyrics` skips the alignment step
 * entirely, so this provider is tried first and its synced rows sort to the top.
 *
 * `/api/get` wants artist, title and the exact duration and answers 404 when it
 * has nothing. `/api/search` is the loose fallback.
 *
 * Both calls return the whole record, words included. The provider keeps the
 * records of its recent searches, so picking a row costs no second request.
 * LRCLIB limits the request rate (429 with `Retry-After`) and answers 503 when
 * it is busy, so a call that fails that way is sent again before it counts.
 */
import type { LyricsCandidate, LyricsFetchResult } from "@musicbutler/shared";
import { LYRICS_SEARCH_LIMIT } from "@musicbutler/shared";
import { fetchWithTimeout, LyricsError, type LyricsQuery, type Provider } from "./types.ts";

const BASE = "https://lrclib.net/api";

/** Attempts after the first one, for an answer that says "try again". */
const RETRIES = 2;
/** The longest wait between two attempts, whatever `Retry-After` asks for. */
const MAX_RETRY_DELAY_MS = 3000;
/** Statuses that say the server is busy, not that the request is wrong. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

/** How many records the provider keeps, and for how long. */
const CACHE_SIZE = 500;
const CACHE_TTL_MS = 30 * 60_000;

/** One record as LRCLIB returns it. Unused fields are left out on purpose. */
type LrclibRecord = {
	id: number;
	trackName?: string | null;
	artistName?: string | null;
	albumName?: string | null;
	duration?: number | null;
	instrumental?: boolean;
	plainLyrics?: string | null;
	syncedLyrics?: string | null;
};

function toCandidate(record: LrclibRecord): LyricsCandidate {
	const candidate: LyricsCandidate = {
		provider: "lrclib",
		id: String(record.id),
		title: record.trackName?.trim() || "Unknown title",
		artist: record.artistName?.trim() || "Unknown artist",
		synced: typeof record.syncedLyrics === "string" && record.syncedLyrics.trim().length > 0,
	};
	const album = record.albumName?.trim();
	if (album) candidate.album = album;
	if (typeof record.duration === "number" && record.duration > 0) {
		candidate.durationSec = Math.round(record.duration);
	}
	return candidate;
}

/** Records from recent answers, by id. The oldest entry goes first when it is full. */
const records = new Map<string, { record: LrclibRecord; at: number }>();

function remember(record: LrclibRecord): void {
	const id = String(record.id);
	records.delete(id);
	records.set(id, { record, at: Date.now() });
	while (records.size > CACHE_SIZE) {
		const oldest = records.keys().next().value;
		if (oldest === undefined) break;
		records.delete(oldest);
	}
}

function recall(id: string): LrclibRecord | null {
	const entry = records.get(id);
	if (!entry) return null;
	if (Date.now() - entry.at > CACHE_TTL_MS) {
		records.delete(id);
		return null;
	}
	return entry.record;
}

/** Empties the record cache. For tests. */
export function clearLrclibCache(): void {
	records.clear();
}

/** Milliseconds to wait before attempt `attempt + 1`, from `Retry-After` when LRCLIB sends it. */
function retryDelay(response: Response | null, attempt: number): number {
	const header = response?.headers.get("retry-after");
	const seconds = header === null || header === undefined ? Number.NaN : Number(header);
	const ms = Number.isFinite(seconds) ? seconds * 1000 : 250 * 2 ** attempt;
	return Math.min(Math.max(0, ms), MAX_RETRY_DELAY_MS);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * GET with a retry for a busy answer or a dropped connection. Returns the last
 * response, so a 503 that never clears still reaches `readJson` and its message.
 */
async function get(url: string, signal?: AbortSignal): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		let response: Response | null = null;
		try {
			response = await fetchWithTimeout(url, { signal });
		} catch (error) {
			// A cancel or a timeout ends the call: another 10 s wait helps nobody.
			// A dropped connection gets another attempt.
			const aborted = error instanceof Error && error.name === "AbortError";
			if (aborted || signal?.aborted || attempt >= RETRIES) throw error;
		}
		if (response !== null && (!TRANSIENT.has(response.status) || attempt >= RETRIES)) {
			return response;
		}
		await sleep(retryDelay(response, attempt), signal);
	}
}

async function readJson(response: Response, what: string): Promise<unknown> {
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new LyricsError("lrclib", `LRCLIB answered ${response.status} to the ${what}.`);
	}
	try {
		return await response.json();
	} catch {
		throw new LyricsError("lrclib", "LRCLIB sent an answer this app cannot read.");
	}
}

export const lrclib: Provider = {
	id: "lrclib",

	async search(query: LyricsQuery): Promise<LyricsCandidate[]> {
		const out: LyricsCandidate[] = [];
		const seen = new Set<string>();

		// The exact match first: it needs the duration and is the only call that
		// can return the one right record rather than a list of guesses.
		if (query.durationSec !== undefined && query.durationSec > 0) {
			const exact = new URL(`${BASE}/get`);
			exact.searchParams.set("artist_name", query.artist);
			exact.searchParams.set("track_name", query.title);
			if (query.album) exact.searchParams.set("album_name", query.album);
			exact.searchParams.set("duration", String(Math.round(query.durationSec)));
			const hit = await readJson(await get(exact.toString(), query.signal), "exact lookup");
			if (hit !== null) {
				remember(hit as LrclibRecord);
				const candidate = toCandidate(hit as LrclibRecord);
				out.push(candidate);
				seen.add(candidate.id);
			}
		}

		const search = new URL(`${BASE}/search`);
		search.searchParams.set("track_name", query.title);
		if (query.artist) search.searchParams.set("artist_name", query.artist);
		const found = await readJson(await get(search.toString(), query.signal), "search");
		if (Array.isArray(found)) {
			for (const record of found as LrclibRecord[]) {
				remember(record);
				const candidate = toCandidate(record);
				if (seen.has(candidate.id)) continue;
				seen.add(candidate.id);
				out.push(candidate);
				if (out.length >= LYRICS_SEARCH_LIMIT) break;
			}
		}
		return out;
	},

	async fetch(id: string, signal?: AbortSignal): Promise<LyricsFetchResult> {
		// A row from a recent search already holds its words.
		let record = recall(id);
		if (record === null) {
			record = (await readJson(
				await get(`${BASE}/get/${encodeURIComponent(id)}`, signal),
				"lyrics lookup",
			)) as LrclibRecord | null;
			if (record === null) throw new LyricsError("lrclib", "LRCLIB no longer holds that record.");
			remember(record);
		}

		const synced = record.syncedLyrics?.trim() ?? "";
		const plain = record.plainLyrics?.trim() ?? "";
		if (record.instrumental === true && plain === "" && synced === "") {
			throw new LyricsError("lrclib", "LRCLIB marks this track as instrumental.");
		}
		if (plain === "" && synced === "") {
			throw new LyricsError("lrclib", "That record holds no lyrics.");
		}
		return {
			provider: "lrclib",
			id,
			// A synced record always has the plain text too, but fall back to
			// stripping the timestamps rather than handing back an empty editor.
			plain: plain !== "" ? plain : stripTimestamps(synced),
			synced: synced !== "" ? synced : null,
		};
	},
};

/** Drops leading `[mm:ss.xx]` tags, for the rare record that has only synced text. */
function stripTimestamps(lrc: string): string {
	return lrc
		.split("\n")
		.map((line) => line.replace(/^\s*(?:\[\d+:\d+(?:\.\d+)?\]\s*)+/, "").trim())
		.filter((line, index, all) => line !== "" || all[index - 1] !== "")
		.join("\n")
		.trim();
}
