/**
 * `GET /media/stream?path=<library-relative>` (docs/PLAN.md §6.3).
 *
 * Supports HTTP Range (206 + Content-Range + Accept-Ranges), 416 for an
 * unsatisfiable range, ETag / Last-Modified / If-None-Match, and HEAD. Only
 * audio files are streamed. Error responses never echo the path.
 */
import { AUDIO_MIME_TYPES, type AudioExtension } from "@musicbutler/shared";
import { TRPCError } from "@trpc/server";
import type { Context } from "hono";
import { openAudioForStream, type StreamSource } from "../fs/library.ts";
import { log } from "../log.ts";

interface ByteRange {
	start: number;
	end: number;
}

/**
 * Parses a single-range `Range` header against a resource of `size` bytes.
 * Returns `null` when the header is absent or malformed (serve the whole file),
 * `"unsatisfiable"` when the range lies outside the resource.
 */
export function parseRange(
	header: string | undefined,
	size: number,
): ByteRange | "unsatisfiable" | null {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)(?:,|$)/.exec(header.trim());
	if (!m) return null;
	const [, startStr, endStr] = m;
	if (startStr === "" && endStr === "") return null;
	if (size === 0) return "unsatisfiable";
	if (startStr === "") {
		// Suffix range: the last N bytes.
		const suffix = Number(endStr);
		if (suffix === 0) return "unsatisfiable";
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}
	const start = Number(startStr);
	if (start >= size) return "unsatisfiable";
	const end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
	if (end < start) return "unsatisfiable";
	return { start, end };
}

function etagFor(src: StreamSource): string {
	return `"${src.size}-${Math.trunc(src.mtimeMs)}"`;
}

function baseHeaders(src: StreamSource): Headers {
	const h = new Headers();
	h.set("Accept-Ranges", "bytes");
	h.set("Content-Type", AUDIO_MIME_TYPES[src.ext as AudioExtension] ?? "application/octet-stream");
	h.set("ETag", etagFor(src));
	h.set("Last-Modified", new Date(src.mtimeMs).toUTCString());
	h.set("Cache-Control", "private, no-cache");
	return h;
}

function errorStatus(err: unknown): 403 | 404 | 500 {
	if (err instanceof TRPCError) {
		if (err.code === "FORBIDDEN") return 403;
		if (err.code === "NOT_FOUND" || err.code === "BAD_REQUEST") return 404;
		return 500;
	}
	const code =
		typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
	if (code === "ENOENT" || code === "ENOTDIR") return 404;
	if (code === "EACCES" || code === "EPERM") return 403;
	return 500;
}

const STATUS_TEXT: Record<403 | 404 | 500, string> = {
	403: "Forbidden",
	404: "Not Found",
	500: "Internal Server Error",
};

export async function streamHandler(c: Context): Promise<Response> {
	const rel = c.req.query("path");
	if (rel === undefined) return c.text("Missing path", 400);
	const isHead = c.req.method === "HEAD";

	let src: StreamSource;
	try {
		src = await openAudioForStream(rel);
	} catch (err) {
		const status = errorStatus(err);
		if (status === 500) log.error("media/stream failed", err);
		return c.text(STATUS_TEXT[status], status);
	}

	const headers = baseHeaders(src);
	const etag = headers.get("ETag");
	const ifNoneMatch = c.req.header("If-None-Match");
	if (ifNoneMatch && etag && ifNoneMatch.split(",").some((t) => t.trim() === etag)) {
		return new Response(null, { status: 304, headers });
	}

	const range = parseRange(c.req.header("Range"), src.size);
	if (range === "unsatisfiable") {
		headers.set("Content-Range", `bytes */${src.size}`);
		return new Response(null, { status: 416, headers });
	}

	if (range === null) {
		headers.set("Content-Length", String(src.size));
		return new Response(isHead ? null : src.file, { status: 200, headers });
	}

	const { start, end } = range;
	headers.set("Content-Range", `bytes ${start}-${end}/${src.size}`);
	headers.set("Content-Length", String(end - start + 1));
	return new Response(isHead ? null : src.file.slice(start, end + 1), { status: 206, headers });
}
