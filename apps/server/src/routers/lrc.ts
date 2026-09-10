import { isAudioFile } from "@musicbutler/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { deleteLrc, lrcMtime, readLrc, writeLrcAtomic } from "../fs/library.ts";
import { publicProcedure, router } from "../trpc.ts";

const audioPath = z
	.string()
	.refine((p) => isAudioFile(p), { message: "audioPath must point to an audio file" });

export const lrcGetInput = z.object({ audioPath });

export const lrcSaveInput = z.object({
	audioPath,
	content: z.string(),
	/** The mtime the client last saw; null means "the client expects no file". */
	expectedMtimeMs: z.number().nullable(),
});

export type LrcSaveAction = "written" | "deleted" | "noop";

/** `.lrc` read and save with the §5.2 semantics and the mtime CONFLICT check (§6.2). */
export const lrcRouter = router({
	get: publicProcedure.input(lrcGetInput).query(({ input }) => readLrc(input.audioPath)),

	save: publicProcedure
		.input(lrcSaveInput)
		.mutation(async ({ input }): Promise<{ action: LrcSaveAction; mtimeMs: number | null }> => {
			const current = await lrcMtime(input.audioPath);
			if (current !== input.expectedMtimeMs) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "The lyrics file changed on disk since it was loaded",
				});
			}
			if (input.content.trim() === "") {
				if (current === null) return { action: "noop", mtimeMs: null };
				await deleteLrc(input.audioPath);
				return { action: "deleted", mtimeMs: null };
			}
			const mtimeMs = await writeLrcAtomic(input.audioPath, input.content);
			return { action: "written", mtimeMs };
		}),
});
