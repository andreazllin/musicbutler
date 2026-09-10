import { z } from "zod";
import { listDir } from "../fs/library.ts";
import { publicProcedure, router } from "../trpc.ts";

export const libraryListInput = z.object({ path: z.string() });

/** Lazy, one directory at a time (docs/PLAN.md §6.2). */
export const libraryRouter = router({
	list: publicProcedure.input(libraryListInput).query(({ input }) => listDir(input.path)),
});
