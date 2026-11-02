import type { BrowserModel, BrowserModelId } from "@musicbutler/shared";

/** One complete model in the browser's storage. */
export type ModelRecord = { id: BrowserModelId; version: string; bytes: number; savedAt: number };

export type LocalModelState = "ready" | "outdated" | "missing";

/** Compares the browser's copy with what the server serves now. */
export function localState(model: BrowserModel, local: ModelRecord | undefined): LocalModelState {
	if (!local) return "missing";
	return local.version === model.version ? "ready" : "outdated";
}
