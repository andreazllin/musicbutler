/**
 * The alignment worker (docs/PLAN.md §8).
 *
 * Alignment used to run on the server's own thread. Between the calls into ONNX
 * there is a lot of plain JavaScript over large typed arrays, and it blocked:
 * measured on one 90 s track, the event loop stalled 22 times by more than
 * 300 ms, worst 1.7 s, across decode, separate and emit. Every request that
 * arrived in one of those windows simply waited, so the whole app looked hung
 * while a job ran.
 *
 * This module is that work, moved off the server's thread. It speaks a small
 * message protocol and touches no files: the caller hands it an absolute path
 * and gets the aligned result back, and the server thread still owns every
 * read and write to the library (docs/PLAN.md §5.3).
 *
 * The engine per language is cached here, so the models load once and stay in
 * this thread across jobs.
 */
import type { Lang } from "@musicbutler/shared";

type AlignModule = typeof import("@musicbutler/align");
type Engine = InstanceType<AlignModule["LyricsSync"]>;

/** Sent once, before any job, so the engine reads the right model directory. */
export type InitMessage = { type: "init"; cacheDir: string };
export type RunMessage = {
	type: "run";
	id: string;
	/** Absolute path. The worker never resolves a library path itself. */
	audioPath: string;
	lyrics: string;
	lang: Lang;
	separate: boolean;
};
export type CancelMessage = { type: "cancel"; id: string };
export type ToWorker = InitMessage | RunMessage | CancelMessage;

export type FromWorker =
	| { type: "ready" }
	| { type: "progress"; id: string; stage: string; done: number; total: number }
	| { type: "done"; id: string; lines: string[]; words: WorkerWord[] }
	| { type: "error"; id: string; kind: "align" | "abort" | "internal"; message: string };

export type WorkerWord = { text: string; start: number; end: number; line: number };

/**
 * The worker global. The server's tsconfig does not pull in the WebWorker
 * library, and one handler does not justify widening it for every file.
 */
declare const self: { onmessage: ((event: MessageEvent<ToWorker>) => void) | null };

const engines = new Map<Lang, Promise<Engine>>();
const running = new Map<string, AbortController>();
let alignModule: Promise<AlignModule> | undefined;

function loadAlign(): Promise<AlignModule> {
	alignModule ??= import("@musicbutler/align");
	return alignModule;
}

function getEngine(lang: Lang): Promise<Engine> {
	let engine = engines.get(lang);
	if (!engine) {
		engine = loadAlign().then(async ({ LyricsSync }) => {
			const created = new LyricsSync({ lang });
			try {
				await created.load();
			} catch (err) {
				engines.delete(lang);
				throw err;
			}
			return created;
		});
		engines.set(lang, engine);
	}
	return engine;
}

const post = (message: FromWorker) => {
	postMessage(message);
};

async function run(message: RunMessage): Promise<void> {
	const controller = new AbortController();
	running.set(message.id, controller);
	try {
		const { AlignError, AbortError } = await loadAlign();
		const engine = await getEngine(message.lang);
		if (controller.signal.aborted) {
			post({ type: "error", id: message.id, kind: "abort", message: "Cancelled" });
			return;
		}
		try {
			const result = await engine.syncText(message.audioPath, message.lyrics, {
				signal: controller.signal,
				separate: message.separate,
				onProgress: (stage, done, total) => {
					post({ type: "progress", id: message.id, stage, done, total });
				},
			});
			post({ type: "done", id: message.id, lines: result.lines, words: result.words });
		} catch (err) {
			if (controller.signal.aborted || err instanceof AbortError) {
				post({ type: "error", id: message.id, kind: "abort", message: "Cancelled" });
				return;
			}
			if (err instanceof AlignError) {
				post({ type: "error", id: message.id, kind: "align", message: err.message });
				return;
			}
			throw err;
		}
	} catch (err) {
		post({
			type: "error",
			id: message.id,
			kind: "internal",
			message: err instanceof Error ? err.message : "The sync failed.",
		});
	} finally {
		running.delete(message.id);
	}
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
	const message = event.data;
	if (message.type === "init") {
		// The engine reads this when it is first imported (docs/PLAN.md §13.14),
		// so it has to be set before `loadAlign` runs.
		process.env.MUSICBUTLER_CACHE = message.cacheDir;
		post({ type: "ready" });
		return;
	}
	if (message.type === "cancel") {
		running.get(message.id)?.abort();
		return;
	}
	void run(message);
};
