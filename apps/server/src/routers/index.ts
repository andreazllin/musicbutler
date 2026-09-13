/**
 * `appRouter = { jobs, library, lrc, lyrics, sync }` (docs/PLAN.md §6.1). A future tool adds
 * one sibling key here and changes nothing else.
 *
 * The web app imports `type { AppRouter } from "@musicbutler/server/router"`.
 */
import { createCallerFactory, router } from "../trpc.ts";
import { jobsRouter } from "./jobs.ts";
import { libraryRouter } from "./library.ts";
import { lrcRouter } from "./lrc.ts";
import { lyricsRouter } from "./lyrics.ts";
import { syncRouter } from "./sync.ts";

export const appRouter = router({
	jobs: jobsRouter,
	library: libraryRouter,
	lrc: lrcRouter,
	lyrics: lyricsRouter,
	sync: syncRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller, used by tests: `createCaller({})`. */
export const createCaller = createCallerFactory(appRouter);
