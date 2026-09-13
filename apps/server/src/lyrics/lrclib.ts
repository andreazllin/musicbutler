/**
 * LRCLIB (https://lrclib.net/docs).
 *
 * The only source here with an API meant to be called: no key, documented, and
 * it holds timestamps. A hit with `syncedLyrics` skips the alignment step
 * entirely, so this provider is tried first and its synced rows sort to the top.
 *
 * `/api/get` wants artist, title and the exact duration and answers 404 when it
 * has nothing. `/api/search` is the loose fallback.
 */
import type { LyricsCandidate, LyricsFetchResult } from "@musicbutler/shared";
import { LYRICS_SEARCH_LIMIT } from "@musicbutler/shared";
import { fetchWithTimeout, LyricsError, type LyricsQuery, type Provider } from "./types.ts";

const BASE = "https://lrclib.net/api";

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
			const hit = await readJson(
				await fetchWithTimeout(exact.toString(), { signal: query.signal }),
				"exact lookup",
			);
			if (hit !== null) {
				const candidate = toCandidate(hit as LrclibRecord);
				out.push(candidate);
				seen.add(candidate.id);
			}
		}

		const search = new URL(`${BASE}/search`);
		search.searchParams.set("track_name", query.title);
		if (query.artist) search.searchParams.set("artist_name", query.artist);
		const found = await readJson(
			await fetchWithTimeout(search.toString(), { signal: query.signal }),
			"search",
		);
		if (Array.isArray(found)) {
			for (const record of found as LrclibRecord[]) {
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
		const record = (await readJson(
			await fetchWithTimeout(`${BASE}/get/${encodeURIComponent(id)}`, { signal }),
			"lyrics lookup",
		)) as LrclibRecord | null;
		if (record === null) throw new LyricsError("lrclib", "LRCLIB no longer holds that record.");

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
