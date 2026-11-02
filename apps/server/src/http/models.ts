/**
 * `GET /models/<id>/<file>`: one model file for the browser sync
 * (docs/DECISIONS.md, 2026-11-02).
 *
 * The pair must be on the list that `sync/browser-models.ts` builds from
 * configuration, so the path in the URL never reaches the filesystem. The
 * browser keeps its own copy in Cache Storage, so this sends no cache headers
 * beyond an ETag.
 */
import type { Context } from "hono";
import { openModelFile, statModelFile } from "../fs/models.ts";
import { resolveBrowserModelFile } from "../sync/browser-models.ts";

const PREFIX = "/models/";

export async function modelFileHandler(c: Context): Promise<Response> {
	const rest = c.req.path.slice(PREFIX.length);
	const slash = rest.indexOf("/");
	if (slash <= 0) return c.text("Not Found", 404);
	let id: string;
	let name: string;
	try {
		id = decodeURIComponent(rest.slice(0, slash));
		name = decodeURIComponent(rest.slice(slash + 1));
	} catch {
		return c.text("Not Found", 404);
	}
	const path = await resolveBrowserModelFile(id, name);
	const info = path ? await statModelFile(path) : null;
	if (!path || !info) return c.text("Not Found", 404);

	const etag = `"${info.bytes}-${Math.trunc(info.mtimeMs)}"`;
	const headers = new Headers({
		"Content-Type": name.endsWith(".json") ? "application/json" : "application/octet-stream",
		"Content-Length": String(info.bytes),
		ETag: etag,
		"Cache-Control": "no-cache",
	});
	if (c.req.header("If-None-Match") === etag) return new Response(null, { status: 304, headers });
	if (c.req.method === "HEAD") return new Response(null, { status: 200, headers });
	return new Response(openModelFile(path), { status: 200, headers });
}
