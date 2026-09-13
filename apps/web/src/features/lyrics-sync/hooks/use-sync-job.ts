import type { SyncEvent, SyncStage } from "@musicbutler/shared";
import { useMutation } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect, useState } from "react";
import { activeJobFor } from "@/features/jobs/helpers/queue";
import { useJobs } from "@/features/jobs/hooks/use-jobs";
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
	/** The song the screen shows now. The hook follows the job for this song. */
	song: string | null;
	onDone: (result: { audioPath: string; content: string; mtimeMs: number }) => void;
	onError: (error: { audioPath: string; code: string; message: string }) => void;
};

/**
 * Follows the sync job of one song (docs/PLAN.md §6.2 `sync.*`, §7.5).
 *
 * The job belongs to the server, not to this screen. The hook holds the id and
 * the path of the job it follows, and the path is what the result is applied
 * to: a user may switch songs while a job runs, and the finished lyrics must
 * reach the song that was aligned, never the song that happens to be open.
 *
 * When the screen opens on a song that already has a job in the queue, the hook
 * adopts it, so leaving the screen and coming back picks the progress up again.
 */
export function useSyncJob({ song, onDone, onError }: Handlers) {
	const trpc = useTRPC();
	const { jobs } = useJobs();
	const [job, setJob] = useState<{ id: string; audioPath: string } | null>(null);
	const [progress, setProgress] = useState<SyncProgressState | null>(null);

	// Adopt the job the server already holds for this song.
	const serverJob = activeJobFor(jobs, song);
	useEffect(() => {
		if (serverJob === undefined) return;
		setJob((current) =>
			current?.id === serverJob.id ? current : { id: serverJob.id, audioPath: serverJob.audioPath },
		);
	}, [serverJob]);

	const start = useMutation({
		...trpc.sync.start.mutationOptions(),
		onSuccess: ({ jobId }, variables) => {
			setProgress({ stage: "queued", pct: 0 });
			setJob({ id: jobId, audioPath: variables.audioPath });
		},
		onError: (error) => {
			notify.error(error.message || "The sync could not start.");
		},
	});

	const cancel = useMutation({
		...trpc.sync.cancel.mutationOptions(),
		onError: (error) => notify.error(error.message || "The app could not cancel the sync."),
	});

	const finish = useCallback(() => {
		setJob(null);
		setProgress(null);
	}, []);

	useSubscription(
		trpc.sync.progress.subscriptionOptions(
			{ jobId: job?.id ?? "" },
			{
				enabled: job !== null,
				onData: (event: SyncEvent) => {
					const audioPath = job?.audioPath;
					if (audioPath === undefined) return;
					if (event.type === "progress") {
						setProgress({ stage: event.stage, pct: event.pct, message: event.message });
					} else if (event.type === "done") {
						finish();
						onDone({ audioPath, content: event.content, mtimeMs: event.mtimeMs });
					} else {
						finish();
						onError({ audioPath, code: event.code, message: event.message });
					}
				},
				onError: (error) => {
					const audioPath = job?.audioPath;
					finish();
					if (audioPath === undefined) return;
					onError({
						audioPath,
						code: "SUBSCRIPTION",
						message: error.message || "The app lost the connection to the job.",
					});
				},
			},
		),
	);

	/** True only while this song has a job. A job on another song blocks nothing. */
	const isRunningForSong = job !== null && job.audioPath === song;
	const stage = serverJob?.status === "queued" ? "queued" : progress?.stage;

	return {
		isRunning: isRunningForSong || (start.isPending && start.variables?.audioPath === song),
		/** Set while this song's job is queued or running. */
		progress:
			isRunningForSong && progress !== null
				? { ...progress, stage: stage ?? progress.stage }
				: null,
		start: (input: StartInput) => start.mutate(input),
		cancel: () => {
			if (job) cancel.mutate({ jobId: job.id });
		},
		isCancelling: cancel.isPending,
	};
}
