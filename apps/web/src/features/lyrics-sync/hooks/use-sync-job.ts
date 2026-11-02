import type { BrowserModel, Lang, SyncEvent } from "@musicbutler/shared";
import { useMutation } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect, useState } from "react";
import { useBrowserModels } from "@/features/browser-sync/hooks/use-browser-models";
import { useBrowserSyncJob } from "@/features/browser-sync/hooks/use-browser-sync-job";
import { activeJobFor } from "@/features/jobs/helpers/queue";
import { useJobs } from "@/features/jobs/hooks/use-jobs";
import { notify } from "@/lib/notify";
import { useTRPC } from "@/lib/trpc";
import { useSettingsStore } from "@/stores/settings-store";
import type { SyncProgressStage } from "../constants";

export type SyncProgressState = { stage: SyncProgressStage; pct: number; message?: string };

type StartInput = {
	audioPath: string;
	lyrics: string;
	lang: Lang;
	options?: { isolateVocals?: boolean; leadInMs?: number; wordTimestamps?: boolean };
};

type Handlers = {
	/** The song the screen shows now. The hook follows the job for this song. */
	song: string | null;
	onDone: (result: { audioPath: string; content: string; mtimeMs: number }) => void;
	onError: (error: { audioPath: string; code: string; message: string }) => void;
};

/**
 * Follows the sync job of one song, wherever it runs. The Settings screen
 * picks where a new job runs. A job that already runs is followed to the end
 * in the place it started, even when the setting changes in between.
 *
 * In browser mode, `missingModels` lists what this browser must download
 * before the sync can run. The caller asks the user first, because the models
 * are hundreds of megabytes. The job then downloads them as its first stage.
 */
export function useSyncJob(handlers: Handlers) {
	const mode = useSettingsStore((s) => s.syncMode);
	const server = useServerSyncJob(handlers);
	const browser = useBrowserSyncJob(handlers);
	const models = useBrowserModels();

	return {
		mode,
		isRunning: server.isRunning || browser.isRunning,
		progress: browser.progress ?? server.progress,
		/** In browser mode, the models to download before `start`. Empty in server mode. */
		missingModels: (lang: Lang, isolateVocals: boolean): BrowserModel[] =>
			mode === "browser" ? models.missingFor(lang, isolateVocals) : [],
		start: (input: StartInput) => {
			if (mode === "server") {
				server.start(input);
				return;
			}
			const isolateVocals = input.options?.isolateVocals ?? true;
			const { asr, separation } = models.neededFor(input.lang, isolateVocals);
			if (asr === null || !asr.available || (isolateVocals && !separation?.available)) {
				notify.error(
					"The server does not have the models for this sync. Set the sync to run on the server in Settings.",
				);
				return;
			}
			browser.start({
				audioPath: input.audioPath,
				lyrics: input.lyrics,
				lang: input.lang,
				isolateVocals,
				wordTimestamps: input.options?.wordTimestamps ?? true,
				leadInMs: input.options?.leadInMs,
				asr,
				separation,
			});
		},
		cancel: () => {
			if (browser.isRunning) browser.cancel();
			else server.cancel();
		},
		isCancelling: server.isCancelling,
	};
}

/**
 * Follows the server sync job of one song (docs/PLAN.md §6.2 `sync.*`, §7.5).
 *
 * The job belongs to the server, not to this screen. The hook holds the id and
 * the path of the job it follows, and the path is what the result is applied
 * to: a user may switch songs while a job runs, and the finished lyrics must
 * reach the song that was aligned, never the song that happens to be open.
 *
 * When the screen opens on a song that already has a job in the queue, the hook
 * adopts it, so leaving the screen and coming back picks the progress up again.
 */
function useServerSyncJob({ song, onDone, onError }: Handlers) {
	const trpc = useTRPC();
	const { jobs } = useJobs();
	const [job, setJob] = useState<{ id: string; audioPath: string } | null>(null);
	const [progress, setProgress] = useState<SyncProgressState | null>(null);

	// Adopt the job the server already holds for this song.
	const serverJob = activeJobFor(jobs, "lyrics-sync", song);
	useEffect(() => {
		if (serverJob === undefined) return;
		setJob((current) =>
			current?.id === serverJob.id ? current : { id: serverJob.id, audioPath: serverJob.ref },
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
