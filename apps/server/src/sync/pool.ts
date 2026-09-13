/**
 * Owns the one alignment worker (docs/PLAN.md §8).
 *
 * One worker, not one per job: the models are hundreds of megabytes and take
 * seconds to load, so the thread is kept alive and reused. The queue already
 * runs one job at a time, so a second thread would only add memory.
 *
 * A cancel is sent as a message, but the worker may be inside a long run of
 * native or synchronous work and not read it. So a cancel that is not honoured
 * within `CANCEL_GRACE_MS` terminates the thread and drops the loaded models.
 * That costs a reload on the next job and is the only way to make Cancel mean
 * now rather than eventually.
 */
import type { Lang } from "@musicbutler/shared";
import { log } from "../log.ts";
import type { FromWorker, ToWorker, WorkerWord } from "./worker.ts";

/** How long a polite cancel gets before the thread is terminated. */
export const CANCEL_GRACE_MS = 2000;

export interface AlignRequest {
	/** Absolute path. The caller resolves the library path. */
	audioPath: string;
	lyrics: string;
	lang: Lang;
	separate: boolean;
	signal: AbortSignal;
	onProgress: (stage: string, done: number, total: number) => void;
}

export interface AlignResult {
	lines: string[];
	words: WorkerWord[];
}

/** Thrown when the job was cancelled, so the caller can stay quiet about it. */
export class AlignAborted extends Error {
	override name = "AlignAborted";
}

/** The engine reported that the lyrics do not fit the audio. */
export class AlignFailed extends Error {
	override name = "AlignFailed";
}

type Pending = {
	resolve: (result: AlignResult) => void;
	reject: (error: unknown) => void;
	onProgress: AlignRequest["onProgress"];
};

let worker: Worker | null = null;
let ready: Promise<Worker> | null = null;
const pending = new Map<string, Pending>();

function failAll(reason: unknown): void {
	for (const [, entry] of pending) entry.reject(reason);
	pending.clear();
}

/** Drops the worker. The next job starts a new one and reloads the models. */
export function terminateWorker(reason: string): void {
	if (worker) {
		log.warn(`sync worker terminated: ${reason}`);
		worker.terminate();
	}
	worker = null;
	ready = null;
}

function spawn(cacheDir: string): Promise<Worker> {
	const created = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" });

	created.addEventListener("message", (event: MessageEvent<FromWorker>) => {
		const message = event.data;
		if (message.type === "ready") return;
		const entry = pending.get(message.id);
		if (!entry) return;
		if (message.type === "progress") {
			entry.onProgress(message.stage, message.done, message.total);
			return;
		}
		pending.delete(message.id);
		if (message.type === "done") {
			entry.resolve({ lines: message.lines, words: message.words });
			return;
		}
		entry.reject(
			message.kind === "abort"
				? new AlignAborted(message.message)
				: message.kind === "align"
					? new AlignFailed(message.message)
					: new Error(message.message),
		);
	});

	created.addEventListener("error", (event) => {
		const reason = event instanceof ErrorEvent ? event.message : "the worker failed";
		failAll(new Error(`The alignment worker failed: ${reason}`));
		terminateWorker(reason);
	});

	// A worker that exits with jobs in flight must not leave them hanging.
	created.addEventListener("close", () => {
		if (pending.size > 0) failAll(new Error("The alignment worker stopped."));
		worker = null;
		ready = null;
	});

	worker = created;
	const init: ToWorker = { type: "init", cacheDir };
	created.postMessage(init);
	return Promise.resolve(created);
}

function getWorker(cacheDir: string): Promise<Worker> {
	ready ??= spawn(cacheDir);
	return ready;
}

/** Runs one alignment on the worker thread. */
export async function runAlignment(request: AlignRequest, cacheDir: string): Promise<AlignResult> {
	const active = await getWorker(cacheDir);
	const id = crypto.randomUUID();

	const result = new Promise<AlignResult>((resolve, reject) => {
		pending.set(id, { resolve, reject, onProgress: request.onProgress });
	});

	const onAbort = () => {
		const cancel: ToWorker = { type: "cancel", id };
		active.postMessage(cancel);
		// If the thread is wedged, stop waiting for it to be polite.
		setTimeout(() => {
			if (!pending.has(id)) return;
			pending.delete(id);
			terminateWorker("a cancel was not honoured in time");
			failAll(new AlignAborted("Cancelled"));
		}, CANCEL_GRACE_MS).unref?.();
	};

	if (request.signal.aborted) throw new AlignAborted("Cancelled");
	request.signal.addEventListener("abort", onAbort, { once: true });

	const run: ToWorker = {
		type: "run",
		id,
		audioPath: request.audioPath,
		lyrics: request.lyrics,
		lang: request.lang,
		separate: request.separate,
	};
	active.postMessage(run);

	try {
		return await result;
	} finally {
		request.signal.removeEventListener("abort", onAbort);
	}
}
