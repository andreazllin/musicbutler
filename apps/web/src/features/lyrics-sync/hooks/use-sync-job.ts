import type { SyncEvent, SyncStage } from "@musicbutler/shared";
import { useMutation } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useState } from "react";
import { notify } from "@/lib/notify";
import { useTRPC } from "@/lib/trpc";

export type SyncProgressState = { stage: SyncStage; pct: number; message?: string };

type StartInput = {
	audioPath: string;
	lyrics: string;
	lang: "en-US" | "it-IT";
	options?: { isolateVocals?: boolean; leadInMs?: number; wordTimestamps?: boolean };
};

type Handlers = {
	onDone: (result: { content: string; mtimeMs: number }) => void;
	onError: (error: { code: string; message: string }) => void;
};

/**
 * Starts, follows and cancels one sync job (docs/PLAN.md §6.2 `sync.*`, §7.5).
 * Progress arrives over the SSE subscription. Job state is server state, so the
 * only local state is the id of the job this screen follows.
 */
export function useSyncJob({ onDone, onError }: Handlers) {
	const trpc = useTRPC();
	const [jobId, setJobId] = useState<string | null>(null);
	const [progress, setProgress] = useState<SyncProgressState | null>(null);

	const start = useMutation({
		...trpc.sync.start.mutationOptions(),
		onSuccess: ({ jobId }) => {
			setProgress({ stage: "queued", pct: 0 });
			setJobId(jobId);
		},
		onError: (error) => {
			const message =
				error.data?.code === "CONFLICT"
					? "Another sync is already running. Wait for it to finish."
					: error.message || "The sync could not start.";
			notify.error(message);
		},
	});

	const cancel = useMutation({
		...trpc.sync.cancel.mutationOptions(),
		onError: (error) => notify.error(error.message || "Cancelling failed."),
	});

	const finish = useCallback(() => {
		setJobId(null);
		setProgress(null);
	}, []);

	useSubscription(
		trpc.sync.progress.subscriptionOptions(
			{ jobId: jobId ?? "" },
			{
				enabled: jobId !== null,
				onData: (event: SyncEvent) => {
					if (event.type === "progress") {
						setProgress({ stage: event.stage, pct: event.pct, message: event.message });
					} else if (event.type === "done") {
						finish();
						onDone({ content: event.content, mtimeMs: event.mtimeMs });
					} else {
						finish();
						onError({ code: event.code, message: event.message });
					}
				},
				onError: (error) => {
					finish();
					onError({
						code: "SUBSCRIPTION",
						message: error.message || "Lost the connection to the job.",
					});
				},
			},
		),
	);

	return {
		isRunning: jobId !== null || start.isPending,
		progress,
		start: (input: StartInput) => start.mutate(input),
		cancel: () => {
			if (jobId) cancel.mutate({ jobId });
		},
		isCancelling: cancel.isPending,
	};
}
