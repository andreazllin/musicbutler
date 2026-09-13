import type { JobSummary } from "@musicbutler/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useState } from "react";
import { notify } from "@/lib/notify";
import { useTRPC } from "@/lib/trpc";

/**
 * The job queue as the web app sees it (docs/PLAN.md §6.2).
 *
 * `jobs.list` seeds the cache and `jobs.events` keeps it current, so every
 * reader shares one query key and the app holds one stream. Mount
 * `useJobsStream` once, high in the tree: the sidebar count and the queue
 * screen both have to stay live, and neither one may own the connection,
 * because a screen that is not on the display would take the stream with it.
 */
export function useJobsStream(): void {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const key = trpc.jobs.list.queryKey();

	useSubscription(
		trpc.jobs.events.subscriptionOptions(undefined, {
			onData: (snapshot: JobSummary[]) => {
				queryClient.setQueryData(key, { jobs: snapshot });
			},
			// A dropped stream leaves the list frozen. Refetch to catch up, and let
			// tRPC reconnect on its own.
			onError: () => {
				void queryClient.invalidateQueries({ queryKey: key });
			},
		}),
	);
}

export type JobsState = {
	jobs: JobSummary[];
	isPending: boolean;
	isError: boolean;
};

/** Reads the shared queue cache. Safe to call from as many places as you like. */
export function useJobs(): JobsState {
	const trpc = useTRPC();
	const query = useQuery(trpc.jobs.list.queryOptions());
	return {
		jobs: query.data?.jobs ?? [],
		isPending: query.isPending,
		isError: query.isError,
	};
}

export type CancelJob = {
	cancel: (jobId: string) => void;
	/** The job the app is cancelling right now, if any. */
	pendingId: string | null;
};

/** Cancels a job, whether it runs or still waits in the queue. */
export function useCancelJob(): CancelJob {
	const trpc = useTRPC();
	const [pendingId, setPendingId] = useState<string | null>(null);

	const mutation = useMutation({
		...trpc.sync.cancel.mutationOptions(),
		onError: (error) => notify.error(error.message || "The app could not cancel the job."),
		onSettled: () => setPendingId(null),
	});

	const cancel = useCallback(
		(jobId: string) => {
			setPendingId(jobId);
			mutation.mutate({ jobId });
		},
		[mutation],
	);

	return { cancel, pendingId };
}

/** Forgets every finished job so the screen shows only what still matters. */
export function useClearFinishedJobs(): { clear: () => void; isPending: boolean } {
	const trpc = useTRPC();
	const mutation = useMutation({
		...trpc.jobs.clearFinished.mutationOptions(),
		onError: (error) => notify.error(error.message || "The app could not clear the list."),
	});
	return { clear: () => mutation.mutate(), isPending: mutation.isPending };
}
