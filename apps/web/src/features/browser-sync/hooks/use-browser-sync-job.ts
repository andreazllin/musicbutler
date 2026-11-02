import { useEffect, useRef } from "react";
import { notify } from "@/lib/notify";
import { useBrowserSyncStore } from "@/stores/browser-sync-store";
import {
	type BrowserSyncEvent,
	type BrowserSyncInput,
	cancelBrowserSync,
	startBrowserSync,
	subscribeBrowserSync,
} from "../lib/runner";

type Handlers = {
	/** The song the screen shows now. */
	song: string | null;
	onDone: (result: { audioPath: string; content: string; mtimeMs: number }) => void;
	onError: (error: { audioPath: string; code: string; message: string }) => void;
};

/**
 * Follows the browser sync of one song, as `useSyncJob` follows a server job.
 * The runner owns the job, so the hook only reads the store and hears the
 * result. The result names the song that was aligned, never the open one.
 */
export function useBrowserSyncJob({ song, onDone, onError }: Handlers) {
	const job = useBrowserSyncStore((s) =>
		song === null
			? undefined
			: s.jobs.find(
					(j) => j.audioPath === song && (j.status === "queued" || j.status === "running"),
				),
	);

	// The runner calls back long after this render, so it reads the newest handlers.
	const handlers = useRef({ onDone, onError });
	useEffect(() => {
		handlers.current = { onDone, onError };
	});

	useEffect(
		() =>
			subscribeBrowserSync((event: BrowserSyncEvent) => {
				if (event.type === "done") {
					handlers.current.onDone({
						audioPath: event.audioPath,
						content: event.content,
						mtimeMs: event.mtimeMs,
					});
				} else {
					handlers.current.onError({
						audioPath: event.audioPath,
						code: event.code,
						message: event.message,
					});
				}
			}),
		[],
	);

	return {
		isRunning: job !== undefined,
		progress: job ? { stage: job.stage, pct: job.pct, message: job.message } : null,
		start: (input: BrowserSyncInput) => {
			try {
				startBrowserSync(input);
			} catch (err) {
				notify.error(err instanceof Error ? err.message : "The sync could not start.");
			}
		},
		cancel: () => {
			if (job) cancelBrowserSync(job.id);
		},
	};
}
