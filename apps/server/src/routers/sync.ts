/**
 * `sync.*` procedures (docs/PLAN.md §6.2, §7.5, §13.13).
 *
 * `start` queues a job and returns at once; `progress` streams the job's events
 * over SSE; `cancel` aborts it, whether it runs or still waits. The queue runs
 * one job at a time and is owned by `../jobs/registry.ts`; the engine wiring
 * lives in `../sync/engine.ts`.
 */
import { isAudioFile, LANGS, MAX_QUEUED_JOBS, type SyncEvent } from "@musicbutler/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { jobs } from "../jobs/registry.ts";
import { listLanguages, runSyncJob } from "../sync/engine.ts";
import { publicProcedure, router } from "../trpc.ts";

export const langSchema = z.enum(LANGS);

export const syncStartInput = z.object({
	audioPath: z
		.string()
		.refine((p) => isAudioFile(p), { message: "audioPath must point to an audio file" }),
	/** Raw editor text. */
	lyrics: z.string(),
	lang: langSchema,
	options: z
		.object({
			isolateVocals: z.boolean().optional(),
			leadInMs: z.number().min(0).max(10_000).optional(),
			wordTimestamps: z.boolean().optional(),
		})
		.optional(),
});

export const syncStartOutput = z.object({ jobId: z.string() });

export const syncLanguagesOutput = z.object({
	langs: z.array(z.object({ code: langSchema, label: z.string(), available: z.boolean() })),
});

export const syncProgressInput = z.object({ jobId: z.string() });

export const syncCancelInput = z.object({ jobId: z.string() });
export const syncCancelOutput = z.object({ cancelled: z.boolean() });

export const syncRouter = router({
	languages: publicProcedure
		.output(syncLanguagesOutput)
		.query(async () => ({ langs: await listLanguages() })),

	start: publicProcedure
		.input(syncStartInput)
		.output(syncStartOutput)
		.mutation(async ({ input }) => {
			// Two jobs on one song would race to write the same .lrc file.
			if (jobs.hasActiveJobFor(input.audioPath)) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "This song is already in the queue.",
				});
			}
			if (jobs.queuedCount() >= MAX_QUEUED_JOBS) {
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "The queue is full. Wait for a job to finish.",
				});
			}
			const langs = await listLanguages();
			if (!langs.find((l) => l.code === input.lang)?.available) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: `No model is installed for ${input.lang}`,
				});
			}
			// The queue calls the runner once this job reaches the front.
			const job = jobs.createJob(
				{ audioPath: input.audioPath, lang: input.lang, options: input.options },
				(queued) => runSyncJob(queued, input),
			);
			return { jobId: job.id };
		}),

	cancel: publicProcedure
		.input(syncCancelInput)
		.output(syncCancelOutput)
		.mutation(({ input }) => {
			const job = jobs.getJob(input.jobId);
			return { cancelled: job ? job.cancel() : false };
		}),

	progress: publicProcedure.input(syncProgressInput).subscription(async function* ({
		input,
		signal,
	}): AsyncGenerator<SyncEvent, void, unknown> {
		const job = jobs.getJob(input.jobId);
		if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown job" });
		for await (const event of job.subscribe()) {
			if (signal?.aborted) return;
			yield event;
		}
	}),
});
