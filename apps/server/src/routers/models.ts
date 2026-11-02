/**
 * `models.browser`: what a browser can download to run a sync itself
 * (docs/DECISIONS.md, 2026-11-02). The files are served by `GET /models/*`.
 */
import { z } from "zod";
import { listBrowserModels } from "../sync/browser-models.ts";
import { publicProcedure, router } from "../trpc.ts";
import { langSchema } from "./sync.ts";

export const browserModelSchema = z.object({
	id: z.union([z.literal("separation"), langSchema]),
	files: z.array(z.object({ name: z.string(), bytes: z.number() })),
	bytes: z.number(),
	available: z.boolean(),
	version: z.string(),
});

export const modelsRouter = router({
	browser: publicProcedure
		.output(z.object({ models: z.array(browserModelSchema) }))
		.query(async () => ({ models: await listBrowserModels() })),
});
