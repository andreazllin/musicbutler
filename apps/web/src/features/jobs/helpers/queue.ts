import { isActiveJob, type JobKind, type JobSummary } from "@musicbutler/shared";

/**
 * Queue order for the screen: the running job first, then the ones still
 * waiting in the order they were queued, then the finished ones with the most
 * recent first. A finished job that just failed is what the user looks for, so
 * it must not sink under an hour of older successes.
 */
export function sortForDisplay(jobs: readonly JobSummary[]): JobSummary[] {
	const rank = (job: JobSummary) =>
		job.status === "running" ? 0 : isActiveJob(job.status) ? 1 : 2;
	return [...jobs].sort((a, b) => {
		const byRank = rank(a) - rank(b);
		if (byRank !== 0) return byRank;
		// Finished jobs run newest first; queued jobs keep the order they arrived.
		if (rank(a) === 2) return (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
		return a.createdAt - b.createdAt;
	});
}

/** How many jobs still hold a place in the queue. */
export function activeCount(jobs: readonly JobSummary[]): number {
	return jobs.filter((job) => isActiveJob(job.status)).length;
}

/**
 * The queued or running job of one kind working on `ref`, if there is one.
 * A tool asks with its own kind, so two kinds may use the same reference.
 */
export function activeJobFor(
	jobs: readonly JobSummary[],
	kind: JobKind,
	ref: string | null,
): JobSummary | undefined {
	if (ref === null) return undefined;
	return jobs.find((job) => job.kind === kind && job.ref === ref && isActiveJob(job.status));
}

/**
 * `1m 04s` style run time. A queued job has not started, so it reads as null
 * and the screen shows its place in the queue instead of a meaningless zero.
 */
export function elapsedLabel(job: JobSummary, now: number): string | null {
	if (job.startedAt === null) return null;
	const end = job.finishedAt ?? now;
	const seconds = Math.max(0, Math.round((end - job.startedAt) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}
