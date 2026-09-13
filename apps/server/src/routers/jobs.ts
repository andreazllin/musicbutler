/**
 * `jobs.*` procedures: what the queue screen reads (docs/PLAN.md §6.2).
 *
 * `list` is the one-shot read that seeds the screen. `events` streams a
 * snapshot of the whole queue on every change, so the screen never polls.
 * A snapshot is small and bounded by `MAX_QUEUED_JOBS`, and sending the whole
 * list keeps the client free of merge rules for create, finish and expiry.
 *
 * Cancelling stays on `sync.cancel`, because a job in this queue is a sync job.
 */
import type { JobSummary } from "@musicbutler/shared";
import { z } from "zod";
import { jobs } from "../jobs/registry.ts";
import { publicProcedure, router } from "../trpc.ts";

export const jobsListOutput = z.object({ jobs: z.array(z.custom<JobSummary>()) });

export const jobsClearOutput = z.object({ removed: z.number() });

export const jobsRouter = router({
	list: publicProcedure
		.output(jobsListOutput)
		.query(() => ({ jobs: jobs.listJobs().map((j) => j.summary()) })),

	/** Forgets every job that already finished. Running and queued jobs stay. */
	clearFinished: publicProcedure
		.output(jobsClearOutput)
		.mutation(() => ({ removed: jobs.clearFinished() })),

	events: publicProcedure.subscription(async function* ({
		signal,
	}): AsyncGenerator<JobSummary[], void, unknown> {
		for await (const snapshot of jobs.subscribeList()) {
			if (signal?.aborted) return;
			yield snapshot;
		}
	}),
});
