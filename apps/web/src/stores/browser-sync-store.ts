import type { JobStatus, Lang } from "@musicbutler/shared";
import { create } from "zustand";
import type { BrowserSyncStage } from "@/features/browser-sync/constants";

/**
 * One lyrics sync that runs in this browser. It has the fields of a server job
 * that the queue screen draws, so both kinds show in one list. It lives as
 * long as the page: a reload ends it.
 */
export type BrowserJob = {
	/** `browser-<n>`, so it never collides with a server job id. */
	id: string;
	audioPath: string;
	lang: Lang;
	status: JobStatus;
	stage: BrowserSyncStage;
	pct: number;
	message?: string;
	createdAt: number;
	startedAt: number | null;
	finishedAt: number | null;
	error?: string;
};

type BrowserSyncState = {
	jobs: BrowserJob[];
	addJob: (job: BrowserJob) => void;
	patchJob: (id: string, patch: Partial<BrowserJob>) => void;
	clearFinished: () => void;
};

/**
 * The jobs of the browser sync runner (`features/browser-sync/lib/runner.ts`).
 * The runner writes, the screens read.
 */
export const useBrowserSyncStore = create<BrowserSyncState>((set) => ({
	jobs: [],
	addJob: (job) => set((s) => ({ jobs: [...s.jobs, job] })),
	patchJob: (id, patch) =>
		set((s) => ({ jobs: s.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)) })),
	clearFinished: () =>
		set((s) => ({
			jobs: s.jobs.filter((job) => job.status === "queued" || job.status === "running"),
		})),
}));
