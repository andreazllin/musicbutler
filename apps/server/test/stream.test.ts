import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRange } from "../src/http/stream.ts";
import { createApp } from "../src/index.ts";
import { makeTempLibrary, SONG_FLAC, SONG_MP3, type TempLibrary } from "./helpers.ts";

let lib: TempLibrary;
let app: ReturnType<typeof createApp>;

const url = (p: string) => `http://localhost/media/stream?path=${encodeURIComponent(p)}`;

beforeAll(() => {
	lib = makeTempLibrary();
	symlinkSync("/etc/hosts", join(lib.dir, "Artist Two", "escape.mp3"));
	app = createApp({ serveWeb: false });
});
afterAll(() => lib.cleanup());

describe("GET /media/stream (docs/PLAN.md §6.3)", () => {
	test("Range: bytes=100-199 → 206 with exactly those bytes", async () => {
		const bytes = readFileSync(join(lib.dir, SONG_FLAC));
		const res = await app.request(url(SONG_FLAC), { headers: { Range: "bytes=100-199" } });
		expect(res.status).toBe(206);
		expect(res.headers.get("Content-Range")).toBe(`bytes 100-199/${bytes.length}`);
		expect(res.headers.get("Accept-Ranges")).toBe("bytes");
		expect(res.headers.get("Content-Length")).toBe("100");
		expect(res.headers.get("Content-Type")).toBe("audio/flac");
		const body = Buffer.from(await res.arrayBuffer());
		expect(body.length).toBe(100);
		expect(body.equals(bytes.subarray(100, 200))).toBe(true);
	});

	test("open-ended and suffix ranges", async () => {
		const bytes = readFileSync(join(lib.dir, SONG_MP3));
		const tail = await app.request(url(SONG_MP3), {
			headers: { Range: `bytes=${bytes.length - 10}-` },
		});
		expect(tail.status).toBe(206);
		expect(tail.headers.get("Content-Range")).toBe(
			`bytes ${bytes.length - 10}-${bytes.length - 1}/${bytes.length}`,
		);
		expect(Buffer.from(await tail.arrayBuffer()).equals(bytes.subarray(bytes.length - 10))).toBe(
			true,
		);

		const suffix = await app.request(url(SONG_MP3), { headers: { Range: "bytes=-5" } });
		expect(suffix.status).toBe(206);
		expect(Buffer.from(await suffix.arrayBuffer()).equals(bytes.subarray(bytes.length - 5))).toBe(
			true,
		);

		// An end past EOF is clamped.
		const clamped = await app.request(url(SONG_MP3), { headers: { Range: "bytes=0-99999999" } });
		expect(clamped.status).toBe(206);
		expect(clamped.headers.get("Content-Length")).toBe(String(bytes.length));
	});

	test("full GET → 200 with Content-Type, ETag, Last-Modified, Content-Length", async () => {
		const s = statSync(join(lib.dir, SONG_MP3));
		const res = await app.request(url(SONG_MP3));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
		expect(res.headers.get("Accept-Ranges")).toBe("bytes");
		expect(res.headers.get("Content-Length")).toBe(String(s.size));
		expect(res.headers.get("ETag")).toBe(`"${s.size}-${Math.trunc(s.mtimeMs)}"`);
		expect(res.headers.get("Last-Modified")).toBe(new Date(s.mtimeMs).toUTCString());
		const body = Buffer.from(await res.arrayBuffer());
		expect(body.equals(readFileSync(join(lib.dir, SONG_MP3)))).toBe(true);
	});

	test("content types per extension", async () => {
		const ogg = await app.request(url("Artist One/Album A/10 Tenth Song.ogg"));
		expect(ogg.headers.get("Content-Type")).toBe("audio/ogg");
		const m4a = await app.request(url("Artist Two/Single.m4a"));
		expect(m4a.headers.get("Content-Type")).toBe("audio/mp4");
	});

	test("Range: bytes=<size>- → 416 with Content-Range: bytes */<size>", async () => {
		const size = statSync(join(lib.dir, SONG_MP3)).size;
		const res = await app.request(url(SONG_MP3), { headers: { Range: `bytes=${size}-` } });
		expect(res.status).toBe(416);
		expect(res.headers.get("Content-Range")).toBe(`bytes */${size}`);
	});

	test("If-None-Match with the current ETag → 304", async () => {
		const first = await app.request(url(SONG_MP3));
		const etag = first.headers.get("ETag") ?? "";
		const res = await app.request(url(SONG_MP3), { headers: { "If-None-Match": etag } });
		expect(res.status).toBe(304);
	});

	test("HEAD works and carries no body", async () => {
		const s = statSync(join(lib.dir, SONG_MP3));
		const res = await app.request(url(SONG_MP3), { method: "HEAD" });
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Length")).toBe(String(s.size));
		expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
		expect((await res.arrayBuffer()).byteLength).toBe(0);
		const ranged = await app.request(url(SONG_MP3), {
			method: "HEAD",
			headers: { Range: "bytes=0-9" },
		});
		expect(ranged.status).toBe(206);
		expect(ranged.headers.get("Content-Range")).toBe(`bytes 0-9/${s.size}`);
		expect((await ranged.arrayBuffer()).byteLength).toBe(0);
	});

	test("path traversal → 403 without echoing the path", async () => {
		for (const p of ["../etc/passwd", "/etc/passwd", "a\\b.mp3", "Artist Two/escape.mp3"]) {
			const res = await app.request(url(p));
			expect(res.status).toBe(403);
			const text = await res.text();
			expect(text).not.toContain("etc");
			expect(text).not.toContain("escape");
		}
	});

	test("missing file → 404; non-audio file → 404; directory → 404", async () => {
		expect((await app.request(url("Artist Two/nope.mp3"))).status).toBe(404);
		expect((await app.request(url("Artist One/Album A/cover.jpg"))).status).toBe(404);
		expect((await app.request(url("Artist One/Album A/02 Second Song.lrc"))).status).toBe(404);
		expect((await app.request(url("Artist One"))).status).toBe(404);
	});

	test("missing path query → 400", async () => {
		expect((await app.request("http://localhost/media/stream")).status).toBe(400);
	});
});

describe("parseRange", () => {
	test("parses the forms browsers send", () => {
		expect(parseRange(undefined, 100)).toBeNull();
		expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
		expect(parseRange("bytes=10-20", 100)).toEqual({ start: 10, end: 20 });
		expect(parseRange("bytes=10-2000", 100)).toEqual({ start: 10, end: 99 });
		expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
		expect(parseRange("bytes=0-9,20-29", 100)).toEqual({ start: 0, end: 9 });
	});
	test("rejects unsatisfiable and ignores malformed", () => {
		expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
		expect(parseRange("bytes=50-40", 100)).toBe("unsatisfiable");
		expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
		expect(parseRange("items=0-1", 100)).toBeNull();
		expect(parseRange("bytes=-", 100)).toBeNull();
	});
});

describe("/healthz and static serving", () => {
	test("/healthz returns the JSON shape", async () => {
		const res = await app.request("http://localhost/healthz");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ ok: true, musicDirWritable: true, modelsReady: false });
	});

	test("modelsReady stays false while the ASR model is missing, even with the Demucs weights", async () => {
		// docs/PLAN.md §8.3: ready means every model of at least one language is on disk.
		const cache = process.env.MODEL_CACHE_DIR ?? "";
		mkdirSync(cache, { recursive: true });
		writeFileSync(join(cache, "htdemucs_fp16weights.onnx"), "fake");
		const res = await app.request("http://localhost/healthz");
		expect(((await res.json()) as { modelsReady: boolean }).modelsReady).toBe(false);
	});

	test("unknown routes are 404 without the web bundle", async () => {
		expect((await app.request("http://localhost/whatever")).status).toBe(404);
	});

	test("serves the web bundle with an SPA fallback when enabled", async () => {
		const dist = join(lib.dir, ".fake-dist");
		mkdirSync(join(dist, "assets"), { recursive: true });
		writeFileSync(join(dist, "index.html"), "<!doctype html><title>mb</title>");
		writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
		const web = createApp({ serveWeb: true, webDistDir: dist });
		const index = await web.request("http://localhost/");
		expect(index.status).toBe(200);
		expect(await index.text()).toContain("<title>mb</title>");
		const asset = await web.request("http://localhost/assets/app.js");
		expect(asset.status).toBe(200);
		expect(asset.headers.get("Content-Type")).toContain("javascript");
		const deep = await web.request("http://localhost/lyrics-sync?song=x");
		expect(deep.status).toBe(200);
		expect(await deep.text()).toContain("<title>mb</title>");
		// API routes keep precedence over the SPA fallback.
		expect((await web.request("http://localhost/healthz")).status).toBe(200);
		expect((await web.request(url("Artist Two/nope.mp3"))).status).toBe(404);
	});
});
