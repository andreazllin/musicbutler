import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearLrclibCache, lrclib } from "../src/lyrics/lrclib.ts";
import { LyricsError } from "../src/lyrics/types.ts";

const RECORD = {
	id: 42,
	trackName: "Song",
	artistName: "Artist",
	albumName: "Album",
	duration: 200,
	instrumental: false,
	plainLyrics: "first line\nsecond line",
	syncedLyrics: "[00:01.00] first line\n[00:02.00] second line",
};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

const realFetch = globalThis.fetch;
let calls: string[] = [];

/** Answers each request with the next reply in the list. */
function mockFetch(replies: Reply[]): void {
	let index = 0;
	globalThis.fetch = (async (input: string | URL | Request) => {
		calls.push(String(input));
		const reply = replies[Math.min(index++, replies.length - 1)] as Reply;
		return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
			status: reply.status,
			headers: reply.headers,
		});
	}) as typeof fetch;
}

beforeEach(() => {
	calls = [];
	clearLrclibCache();
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("lrclib", () => {
	test("a row from a search gives its words with no second request", async () => {
		mockFetch([{ status: 200, body: [RECORD] }]);
		const rows = await lrclib.search({ artist: "Artist", title: "Song" });
		expect(rows.map((r) => r.id)).toEqual(["42"]);
		const result = await lrclib.fetch("42");
		expect(result.synced).toBe(RECORD.syncedLyrics);
		expect(calls).toHaveLength(1);
	});

	test("a 503 that clears is sent again and succeeds", async () => {
		mockFetch([
			{ status: 503, headers: { "retry-after": "0" } },
			{ status: 200, body: RECORD },
		]);
		const result = await lrclib.fetch("42");
		expect(result.plain).toBe(RECORD.plainLyrics);
		expect(calls).toHaveLength(2);
	});

	test("a 429 waits for Retry-After and tries again", async () => {
		mockFetch([
			{ status: 429, headers: { "retry-after": "0" } },
			{ status: 200, body: [RECORD] },
		]);
		const rows = await lrclib.search({ artist: "Artist", title: "Song" });
		expect(rows).toHaveLength(1);
		expect(calls).toHaveLength(2);
	});

	test("a 503 that stays gives up after three attempts with a readable error", async () => {
		mockFetch([{ status: 503, headers: { "retry-after": "0" } }]);
		const error = await lrclib.fetch("42").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(LyricsError);
		expect((error as Error).message).toBe("LRCLIB answered 503 to the lyrics lookup.");
		expect(calls).toHaveLength(3);
	});

	test("a 404 is not sent again", async () => {
		mockFetch([{ status: 404 }]);
		const error = await lrclib.fetch("7").catch((e: unknown) => e);
		expect((error as Error).message).toBe("LRCLIB no longer holds that record.");
		expect(calls).toHaveLength(1);
	});

	test("a record that the search did not return is read from LRCLIB", async () => {
		mockFetch([{ status: 200, body: RECORD }]);
		await lrclib.fetch("42");
		expect(calls).toEqual(["https://lrclib.net/api/get/42"]);
	});
});
