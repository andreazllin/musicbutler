/**
 * The musicbutler server: Hono app, tRPC adapter, media streaming, /healthz
 * and, in production, the built frontend (docs/PLAN.md §6).
 *
 * Importing this module builds the app without listening. `Bun.serve` runs
 * only when the file is the entrypoint, so tests can call `app.request()`.
 */

import { resolve } from "node:path";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getEnv } from "./env.ts";
import { isDirectorySync, isWritableDir } from "./fs/library.ts";
import { streamHandler } from "./http/stream.ts";
import { log } from "./log.ts";
import { modelsReady } from "./models.ts";
import { appRouter } from "./routers/index.ts";

export const WEB_DIST_DIR = resolve(import.meta.dir, "../../web/dist");

export interface CreateAppOptions {
	/** Serve `apps/web/dist` with an SPA fallback. Defaults to production or when dist exists. */
	serveWeb?: boolean;
	webDistDir?: string;
}

export function createApp(opts: CreateAppOptions = {}): Hono {
	const app = new Hono();

	app.use("/trpc/*", trpcServer({ router: appRouter, endpoint: "/trpc" }));

	app.get("/media/stream", streamHandler);

	app.get("/healthz", async (c) => {
		const env = getEnv();
		const [musicDirWritable, ready] = await Promise.all([
			isWritableDir(env.MUSIC_DIR),
			modelsReady(),
		]);
		return c.json({ ok: true, musicDirWritable, modelsReady: ready });
	});

	const distDir = opts.webDistDir ?? WEB_DIST_DIR;
	const serveWeb =
		opts.serveWeb ?? (process.env.NODE_ENV === "production" || isDirectorySync(distDir));
	if (serveWeb) {
		app.use("*", serveStatic({ root: distDir }));
		// SPA fallback for client-side routes.
		app.get("*", serveStatic({ root: distDir, path: "index.html" }));
	}

	app.notFound((c) => c.text("Not Found", 404));
	app.onError((err, c) => {
		log.error(`Unhandled error on ${c.req.method} ${c.req.path}`, err);
		return c.text("Internal Server Error", 500);
	});

	return app;
}

export const app = createApp();

if (import.meta.main) {
	let env: ReturnType<typeof getEnv>;
	try {
		env = getEnv();
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
	const server = Bun.serve({ port: env.PORT, fetch: app.fetch, idleTimeout: 120 });
	log.info(`musicbutler server listening on http://localhost:${server.port}`);
	log.info("config", {
		MUSIC_DIR: env.MUSIC_DIR,
		MODEL_CACHE_DIR: env.MODEL_CACHE_DIR,
		PORT: env.PORT,
		LOG_LEVEL: env.LOG_LEVEL,
		FFMPEG_PATH: env.FFMPEG_PATH,
		serveWeb: isDirectorySync(WEB_DIST_DIR) || process.env.NODE_ENV === "production",
	});
}
