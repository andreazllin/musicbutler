/**
 * Runs lyrics syncs in this browser, one at a time (docs/DECISIONS.md,
 * 2026-11-02).
 *
 * The same steps as a server job (`apps/server/src/sync/engine.ts`), split
 * between the page and a worker: the page downloads what is missing, decodes
 * the audio and writes the result through `lrc.save`; the worker runs the
 * models. The server only serves the audio and the models, and saves the file.
 *
 * The queue is a module, not a component, so a job keeps running when the user
 * leaves the Lyrics Sync screen. It does not survive a reload.
 */
import { buildAlignedDocument, serialize, stripToPlainLyrics } from "@musicbutler/lrc";
import type { BrowserModel, Lang } from "@musicbutler/shared";
import { TRPCClientError } from "@trpc/client";
import { trpcClient } from "@/lib/trpc";
import { useBrowserModelsStore } from "@/stores/browser-models-store";
import { type BrowserJob, useBrowserSyncStore } from "@/stores/browser-sync-store";
import type { BrowserSyncStage } from "../constants";
import { decodeSong, UnsupportedAudioError } from "../helpers/decode-audio";
import { stagePct } from "../helpers/progress";
import { BROWSER_JOB_PREFIX } from "../helpers/to-job-summary";
import type { FromWorker, RunMessage, ToWorker, WorkerStage } from "./protocol";

/** How long a polite cancel gets before the worker is terminated. */
const CANCEL_GRACE_MS = 2000;

export type BrowserSyncInput = {
	audioPath: string;
	/** Raw editor text. */
	lyrics: string;
	lang: Lang;
	isolateVocals: boolean;
	wordTimestamps: boolean;
	leadInMs?: number;
	/** The acoustic model of `lang`, as `models.browser` lists it. */
	asr: BrowserModel;
	/** Needed when `isolateVocals` is true. */
	separation: BrowserModel | null;
};

export type BrowserSyncEvent =
	| { type: "done"; jobId: string; audioPath: string; content: string; mtimeMs: number }
	| { type: "error"; jobId: string; audioPath: string; code: string; message: string };

type Listener = (event: BrowserSyncEvent) => void;

class Cancelled extends Error {
	override name = "Cancelled";
}

let nextId = 1;
const inputs = new Map<string, BrowserSyncInput>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<Listener>();
let current: string | null = null;

/**
 * Hears every job that finishes. With no listener, the runner says nothing,
 * so whoever listens decides how to tell the user.
 */
export function subscribeBrowserSync(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** True while the queue holds the song. Two jobs on one song would race to write it. */
export function hasActiveBrowserJob(audioPath: string): boolean {
	return useBrowserSyncStore
		.getState()
		.jobs.some(
			(job) => job.audioPath === audioPath && (job.status === "queued" || job.status === "running"),
		);
}

/** Queues a sync and returns its id. The queue starts it as soon as it is free. */
export function startBrowserSync(input: BrowserSyncInput): string {
	if (hasActiveBrowserJob(input.audioPath)) throw new Error("This song is already in the queue.");
	const id = `${BROWSER_JOB_PREFIX}${nextId++}`;
	inputs.set(id, input);
	useBrowserSyncStore.getState().addJob({
		id,
		audioPath: input.audioPath,
		lang: input.lang,
		status: "queued",
		stage: "queued",
		pct: 0,
		createdAt: Date.now(),
		startedAt: null,
		finishedAt: null,
	});
	pump();
	return id;
}

/** Cancels a job, whether it runs or still waits. */
export function cancelBrowserSync(id: string): boolean {
	const job = useBrowserSyncStore.getState().jobs.find((j) => j.id === id);
	if (!job || (job.status !== "queued" && job.status !== "running")) return false;
	if (job.status === "queued") {
		inputs.delete(id);
		finish(id, { status: "cancelled", error: "Cancelled" });
		emit({ type: "error", jobId: id, audioPath: job.audioPath, code: "CANCELLED", message: "" });
		return true;
	}
	controllers.get(id)?.abort();
	return true;
}

function emit(event: BrowserSyncEvent): void {
	for (const listener of listeners) listener(event);
}

function patch(id: string, value: Partial<BrowserJob>): void {
	useBrowserSyncStore.getState().patchJob(id, value);
}

function finish(id: string, value: Partial<BrowserJob>): void {
	patch(id, { ...value, finishedAt: Date.now() });
}

function pump(): void {
	if (current !== null) return;
	const next = useBrowserSyncStore.getState().jobs.find((job) => job.status === "queued");
	if (!next) return;
	const input = inputs.get(next.id);
	if (!input) return;
	current = next.id;
	void run(next.id, input).finally(() => {
		inputs.delete(next.id);
		controllers.delete(next.id);
		current = null;
		pump();
	});
}

async function run(id: string, input: BrowserSyncInput): Promise<void> {
	const controller = new AbortController();
	controllers.set(id, controller);
	const { signal } = controller;
	patch(id, { status: "running", startedAt: Date.now() });
	const progress = (stage: BrowserSyncStage, pct: number, message?: string) =>
		patch(id, { stage, pct, message });

	try {
		await ensureModels(input, signal, (received, total) =>
			progress(
				"download",
				total > 0 ? (received / total) * 100 : 0,
				`${formatMb(received)} of ${formatMb(total)}`,
			),
		);

		const lines = stripToPlainLyrics(input.lyrics);
		if (lines.length === 0) {
			throw new CodedError("NO_LYRICS", "The editor holds no lyric lines to align.");
		}

		progress("decode", stagePct(input.isolateVocals, "decode", 0, 1));
		const channels = await decodeSong(input.audioPath, signal);
		progress("decode", stagePct(input.isolateVocals, "decode", 1, 1));

		const result = await alignInWorker(
			{
				type: "run",
				id: nextId++,
				lang: input.lang,
				lyrics: lines.join("\n"),
				channels,
				asr: input.asr,
				separation: input.isolateVocals ? input.separation : null,
			},
			signal,
			(stage, done, total) =>
				progress(
					stage,
					stagePct(input.isolateVocals, stage, done, total),
					stage === "separate" || stage === "transcribe" ? `${done}/${total}` : undefined,
				),
		);

		progress("write", 98);
		const content = serialize(
			buildAlignedDocument(input.lyrics, result.lines, result.words, {
				leadIn: Math.max(0, input.leadInMs ?? 0) / 1000,
				wordTimestamps: input.wordTimestamps,
			}),
		);
		signal.throwIfAborted();
		const mtimeMs = await save(input.audioPath, content);
		finish(id, { status: "done", stage: "write", pct: 100, message: undefined });
		emit({ type: "done", jobId: id, audioPath: input.audioPath, content, mtimeMs });
	} catch (err) {
		if (signal.aborted || err instanceof Cancelled) {
			finish(id, { status: "cancelled", error: "Cancelled" });
			emit({
				type: "error",
				jobId: id,
				audioPath: input.audioPath,
				code: "CANCELLED",
				message: "",
			});
			return;
		}
		const { code, message } = describe(err);
		finish(id, { status: "error", error: message });
		emit({ type: "error", jobId: id, audioPath: input.audioPath, code, message });
	}
}

class CodedError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

function describe(err: unknown): { code: string; message: string } {
	if (err instanceof CodedError) return { code: err.code, message: err.message };
	if (err instanceof UnsupportedAudioError)
		return { code: "UNSUPPORTED_AUDIO", message: err.message };
	if (err instanceof Error) return { code: "INTERNAL", message: err.message };
	return { code: "INTERNAL", message: "The sync failed." };
}

function formatMb(bytes: number): string {
	return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Downloads whichever of the needed models the browser lacks or holds an old copy of. */
async function ensureModels(
	input: BrowserSyncInput,
	signal: AbortSignal,
	onProgress: (received: number, total: number) => void,
): Promise<void> {
	const store = useBrowserModelsStore.getState();
	if (!store.isLoaded) await store.refresh();
	const needed = [input.asr, input.isolateVocals ? input.separation : null].filter(
		(m): m is BrowserModel => m !== null,
	);
	const missing = needed.filter(
		(m) => useBrowserModelsStore.getState().local[m.id]?.version !== m.version,
	);
	if (missing.length === 0) return;
	const total = missing.reduce((sum, m) => sum + m.bytes, 0);
	const tick = () => {
		const { downloads } = useBrowserModelsStore.getState();
		let received = 0;
		for (const m of missing) {
			const d = downloads[m.id];
			// A model with no download in progress is either done or not started.
			received += d ? d.received : useBrowserModelsStore.getState().local[m.id] ? m.bytes : 0;
		}
		onProgress(received, total);
	};
	const unsubscribe = useBrowserModelsStore.subscribe(tick);
	const onAbort = () => {
		for (const m of missing) useBrowserModelsStore.getState().cancelDownload(m.id);
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		tick();
		for (const m of missing) {
			signal.throwIfAborted();
			await useBrowserModelsStore.getState().download(m);
		}
	} finally {
		unsubscribe();
		signal.removeEventListener("abort", onAbort);
	}
}

/**
 * Writes the result. The sync replaces the file whatever it holds, as a server
 * sync does, so the expected mtime is read just before the write. A save that
 * still loses that race is tried once more.
 */
async function save(audioPath: string, content: string): Promise<number> {
	for (let attempt = 0; ; attempt++) {
		const { mtimeMs } = await trpcClient.lrc.get.query({ audioPath });
		try {
			const result = await trpcClient.lrc.save.mutate({
				audioPath,
				content,
				expectedMtimeMs: mtimeMs,
			});
			return result.mtimeMs ?? Date.now();
		} catch (err) {
			const conflict = err instanceof TRPCClientError && err.data?.code === "CONFLICT";
			if (!conflict || attempt > 0) throw err;
		}
	}
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

type AlignOutput = Extract<FromWorker, { type: "done" }>;

let worker: Worker | null = null;

function getWorker(): Worker {
	worker ??= new Worker(new URL("./align.worker.ts", import.meta.url), { type: "module" });
	return worker;
}

/** Drops the worker and the models it holds. The next job starts a new one. */
function terminateWorker(): void {
	worker?.terminate();
	worker = null;
}

function alignInWorker(
	message: RunMessage,
	signal: AbortSignal,
	onProgress: (stage: WorkerStage, done: number, total: number) => void,
): Promise<AlignOutput> {
	signal.throwIfAborted();
	const active = getWorker();
	return new Promise<AlignOutput>((resolve, reject) => {
		let grace: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			active.removeEventListener("message", onMessage);
			active.removeEventListener("error", onError);
			signal.removeEventListener("abort", onAbort);
			if (grace !== undefined) clearTimeout(grace);
		};
		const onMessage = (event: MessageEvent<FromWorker>) => {
			const data = event.data;
			if (data.id !== message.id) return;
			if (data.type === "progress") {
				onProgress(data.stage, data.done, data.total);
				return;
			}
			cleanup();
			if (data.type === "done") resolve(data);
			else if (data.kind === "abort") reject(new Cancelled());
			else if (data.kind === "align") {
				reject(
					new CodedError(
						"ALIGN_FAILED",
						`Alignment failed: ${data.message}. Check that the lyrics match the song and that the language is right.`,
					),
				);
			} else reject(new Error(data.message));
		};
		const onError = (event: ErrorEvent) => {
			cleanup();
			terminateWorker();
			reject(new Error(`The alignment worker failed: ${event.message || "no detail"}`));
		};
		const onAbort = () => {
			const cancel: ToWorker = { type: "cancel", id: message.id };
			active.postMessage(cancel);
			// The worker may be inside one long ONNX call and not read the message.
			grace = setTimeout(() => {
				cleanup();
				terminateWorker();
				reject(new Cancelled());
			}, CANCEL_GRACE_MS);
		};
		active.addEventListener("message", onMessage);
		active.addEventListener("error", onError);
		signal.addEventListener("abort", onAbort, { once: true });
		active.postMessage(
			message,
			message.channels.map((c) => c.buffer),
		);
	});
}
