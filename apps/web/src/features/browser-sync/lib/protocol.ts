import type { AlignedWord } from "@musicbutler/lrc";
import type { BrowserModel, Lang } from "@musicbutler/shared";

/** Messages between the page and the alignment worker. */
export type RunMessage = {
	type: "run";
	id: number;
	lang: Lang;
	/** Plain lyric lines, joined with newlines. */
	lyrics: string;
	/** Decoded audio at 44.1 kHz, one array per channel. The arrays are transferred. */
	channels: Float32Array[];
	/** The acoustic model of `lang`, as the server lists it. */
	asr: BrowserModel;
	/** The separation model, or null to skip separation. */
	separation: BrowserModel | null;
};

export type CancelMessage = { type: "cancel"; id: number };

export type ToWorker = RunMessage | CancelMessage;

export type WorkerStage = "load" | "separate" | "transcribe" | "align";

export type FromWorker =
	| { type: "progress"; id: number; stage: WorkerStage; done: number; total: number }
	| { type: "done"; id: number; lines: string[]; words: AlignedWord[] }
	| { type: "error"; id: number; kind: "align" | "abort" | "internal"; message: string };
