import { type JobSummary, LANG_LABELS } from "@musicbutler/shared";
import type { BrowserJob } from "@/stores/browser-sync-store";

/** Prefix of every browser job id. A server job id is a UUID, so it never matches. */
export const BROWSER_JOB_PREFIX = "browser-";

export function isBrowserJobId(id: string): boolean {
	return id.startsWith(BROWSER_JOB_PREFIX);
}

/**
 * A browser job in the shape of a server job, so the queue screen draws both
 * kinds with one row. The badge says where it runs.
 */
export function toJobSummary(job: BrowserJob): JobSummary {
	const slash = job.audioPath.lastIndexOf("/");
	return {
		id: job.id,
		kind: "lyrics-sync",
		ref: job.audioPath,
		title: job.audioPath.slice(slash + 1),
		subtitle: slash === -1 ? undefined : job.audioPath.slice(0, slash),
		badges: [LANG_LABELS[job.lang], "This browser"],
		status: job.status,
		stage: job.stage,
		pct: job.pct,
		message: job.message,
		createdAt: job.createdAt,
		startedAt: job.startedAt,
		finishedAt: job.finishedAt,
		error: job.error,
	};
}
