/**
 * Wiring between the tRPC `sync.*` procedures and `packages/align`
 * (docs/PLAN.md §8). This module owns: mapping engine stages to `SyncStage`
 * percentages, the 2 s progress heartbeat, the write stage (§8.2 rule 2) and
 * the error mapping (§13.17).
 *
 * The alignment itself runs on a worker thread (`pool.ts`), because it blocks
 * whatever thread it is on. This module stays on the server's thread, so it
 * keeps every read and write to the library (docs/PLAN.md §5.3).
 *
 * The engine is imported lazily so that `getEnv()` has exported
 * `MUSICBUTLER_CACHE` before `packages/align` reads it (§13.14).
 */
import {
	type Line,
	type LrcDocument,
	parse,
	serialize,
	stripToPlainLyrics,
} from "@musicbutler/lrc";
import { LANG_LABELS, type Lang, type SyncEvent, type SyncStage } from "@musicbutler/shared";
import { getEnv } from "../env.ts";
import { writeLrcAtomic } from "../fs/library.ts";
import { resolveLibraryPath } from "../fs/paths.ts";
import type { Job } from "../jobs/registry.ts";
import { log } from "../log.ts";
import { AlignAborted, AlignFailed, runAlignment } from "./pool.ts";

type AlignModule = typeof import("@musicbutler/align");

let alignModule: Promise<AlignModule> | undefined;

/** Imports the engine after the environment is parsed, so its cache dir is right. */
export function loadAlign(): Promise<AlignModule> {
	getEnv();
	alignModule ??= import("@musicbutler/align");
	return alignModule;
}

export interface LanguageInfo {
	code: Lang;
	label: string;
	available: boolean;
}

/** `sync.languages`: which ASR models this build holds (docs/PLAN.md §13.13). */
export async function listLanguages(): Promise<LanguageInfo[]> {
	const { availableLangs } = await loadAlign();
	const langs = await availableLangs();
	return langs.map((l) => ({ code: l.code, label: LANG_LABELS[l.code], available: l.available }));
}

/** `/healthz` `modelsReady`: at least one language can run with no download. */
export async function modelsReady(): Promise<boolean> {
	try {
		return (await listLanguages()).some((l) => l.available);
	} catch (err) {
		log.warn("modelsReady check failed", err);
		return false;
	}
}

export interface SyncJobInput {
	audioPath: string;
	lyrics: string;
	lang: Lang;
	options?: { isolateVocals?: boolean; leadInMs?: number; wordTimestamps?: boolean };
}

type EngineStage = "decode" | "separate" | "emit" | "align" | "write";

const STAGE_MAP: Record<EngineStage, SyncStage> = {
	decode: "decode",
	separate: "separate",
	emit: "transcribe",
	align: "align",
	write: "write",
};

/** Percentage span of each stage, so the bar moves in proportion to wall-clock time. */
function stageSpans(isolateVocals: boolean): Record<EngineStage, [number, number]> {
	return isolateVocals
		? { decode: [0, 3], separate: [3, 70], emit: [70, 93], align: [93, 97], write: [97, 100] }
		: { decode: [0, 5], separate: [5, 5], emit: [5, 90], align: [90, 97], write: [97, 100] };
}

/** Milliseconds between heartbeat progress events (docs/PLAN.md §8.2). */
export const HEARTBEAT_MS = 2000;

/**
 * Runs one job to completion in the background and reports through `job.emit`.
 * Never throws: every failure becomes an `error` event.
 */
export function runSyncJob(job: Job, input: SyncJobInput): void {
	void run(job, input);
}

async function run(job: Job, input: SyncJobInput): Promise<void> {
	const isolateVocals = input.options?.isolateVocals ?? true;
	const wordTimestamps = input.options?.wordTimestamps ?? true;
	const leadIn = Math.max(0, input.options?.leadInMs ?? 0) / 1000;
	const spans = stageSpans(isolateVocals);

	let last: SyncEvent = { type: "progress", stage: "queued", pct: 0, message: "Loading models" };
	const emit = (event: SyncEvent) => {
		last = event;
		job.emit(event);
	};
	emit(last);
	// A silent stage looks like a hang; repeat the latest progress at least every 2 s.
	const heartbeat = setInterval(() => {
		if (last.type === "progress") job.emit(last);
	}, HEARTBEAT_MS);

	try {
		const lines = stripToPlainLyrics(input.lyrics);
		if (lines.length === 0) {
			emit({
				type: "error",
				code: "NO_LYRICS",
				message: "The editor holds no lyric lines to align.",
			});
			return;
		}
		const absAudio = await resolveLibraryPath(input.audioPath);
		if (job.signal.aborted) return;

		try {
			const result = await runAlignment(
				{
					audioPath: absAudio,
					lyrics: lines.join("\n"),
					lang: input.lang,
					separate: isolateVocals,
					signal: job.signal,
					onProgress: (stage, done, total) => {
						const span = spans[stage as EngineStage];
						if (!span) return;
						const [from, to] = span;
						const frac = total > 0 ? Math.min(1, done / total) : 1;
						emit({
							type: "progress",
							stage: STAGE_MAP[stage as EngineStage],
							pct: Math.round((from + (to - from) * frac) * 10) / 10,
							message: stage === "separate" || stage === "emit" ? `${done}/${total}` : undefined,
						});
					},
				},
				getEnv().MODEL_CACHE_DIR,
			);
			if (job.signal.aborted) return;

			emit({ type: "progress", stage: "write", pct: 98 });
			const doc = buildDocument(input.lyrics, result.lines, result.words, {
				leadIn,
				wordTimestamps,
			});
			const content = serialize(doc);
			const mtimeMs = await writeLrcAtomic(input.audioPath, content);
			emit({ type: "done", content, mtimeMs });
		} catch (err) {
			if (job.signal.aborted || err instanceof AlignAborted) return;
			if (err instanceof AlignFailed) {
				emit({
					type: "error",
					code: "ALIGN_FAILED",
					message: `Alignment failed: ${err.message}. Check that the lyrics match the song and that the language is right.`,
				});
				return;
			}
			throw err;
		}
	} catch (err) {
		if (job.signal.aborted) return;
		log.error(`sync job ${job.id} failed`, err);
		emit({
			type: "error",
			code: "INTERNAL",
			message: err instanceof Error ? err.message : "The sync failed.",
		});
	} finally {
		clearInterval(heartbeat);
	}
}

type AlignedWord = { text: string; start: number; end: number; line: number };

/**
 * The write stage (docs/PLAN.md §8.2 rule 2): one timed line per source line
 * that holds words, line time = first word start minus leadIn (clamped at 0),
 * optional `<mm:ss.xx>` word tags, metadata from the editor text preserved.
 */
export function buildDocument(
	editorText: string,
	lines: string[],
	words: AlignedWord[],
	opts: { leadIn: number; wordTimestamps: boolean },
): LrcDocument {
	const byLine = new Map<number, AlignedWord[]>();
	for (const w of words) {
		const list = byLine.get(w.line);
		if (list) list.push(w);
		else byLine.set(w.line, [w]);
	}
	const shift = (t: number) => Math.max(0, t - opts.leadIn);
	const timed: Line[] = [];
	for (const [index, lineWords] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
		const first = lineWords[0];
		if (!first) continue;
		const line: Line = {
			time: shift(first.start),
			text: lines[index] ?? lineWords.map((w) => w.text).join(" "),
		};
		if (opts.wordTimestamps)
			line.words = lineWords.map((w) => ({ time: shift(w.start), text: w.text }));
		timed.push(line);
	}
	return { meta: parse(editorText).meta, lines: timed };
}
