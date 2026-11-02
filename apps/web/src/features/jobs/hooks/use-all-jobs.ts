import { isBrowserJobId, toJobSummary } from "@/features/browser-sync/helpers/to-job-summary";
import { cancelBrowserSync } from "@/features/browser-sync/lib/runner";
import { useBrowserSyncStore } from "@/stores/browser-sync-store";
import {
	type CancelJob,
	type JobsState,
	useCancelJob,
	useClearFinishedJobs,
	useJobs,
} from "./use-jobs";

/**
 * The server's queue and this browser's queue in one list. The sidebar count
 * and the queue screen read this. A tool that follows its own server job reads
 * `useJobs` instead, because a browser job is not on the server.
 */
export function useAllJobs(): JobsState {
	const server = useJobs();
	const browserJobs = useBrowserSyncStore((s) => s.jobs);
	return { ...server, jobs: [...server.jobs, ...browserJobs.map(toJobSummary)] };
}

/** Cancels a job of either queue. */
export function useCancelAnyJob(): CancelJob {
	const server = useCancelJob();
	return {
		cancel: (jobId) => {
			if (isBrowserJobId(jobId)) cancelBrowserSync(jobId);
			else server.cancel(jobId);
		},
		pendingId: server.pendingId,
	};
}

/** Forgets the finished jobs of both queues. */
export function useClearAllFinishedJobs(): { clear: () => void; isPending: boolean } {
	const server = useClearFinishedJobs();
	const clearBrowser = useBrowserSyncStore((s) => s.clearFinished);
	return {
		clear: () => {
			clearBrowser();
			server.clear();
		},
		isPending: server.isPending,
	};
}
