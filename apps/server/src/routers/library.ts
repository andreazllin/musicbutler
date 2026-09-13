import { z } from "zod";
import { listDir, scanTree } from "../fs/library.ts";
import { publicProcedure, router } from "../trpc.ts";

export const libraryListInput = z.object({ path: z.string() });

export const libraryRouter = router({
	/** One directory at a time (docs/PLAN.md §6.2). */
	list: publicProcedure.input(libraryListInput).query(({ input }) => listDir(input.path)),
	/** The whole library, so the web tree can search every folder and song at once. */
	tree: publicProcedure.query(() => scanTree()),
});
