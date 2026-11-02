import type { BrowserModelId } from "@musicbutler/shared";
import { LANG_LABELS } from "@musicbutler/shared";
import type { SyncProgressStage } from "@/features/lyrics-sync/constants";
import { env } from "@/lib/env";

/**
 * Absolute URL of the model directory on the server. Absolute, because the
 * worker resolves it too, and Transformers.js builds its file URLs from it.
 */
export function modelBaseUrl(): string {
	return new URL(`${env.VITE_API_BASE}/models/`, self.location.href).href;
}

/** URL of one model file on the server (`GET /models/<id>/<file>`). */
export function modelFileUrl(id: BrowserModelId, name: string): string {
	const path = name.split("/").map(encodeURIComponent).join("/");
	return `${modelBaseUrl()}${encodeURIComponent(id)}/${path}`;
}

/** What each model is called on the Settings screen. */
export function modelLabel(id: BrowserModelId): string {
	return id === "separation" ? "Vocal isolation" : `Speech model: ${LANG_LABELS[id]}`;
}

/** What each model does, in one sentence. */
export function modelDescription(id: BrowserModelId): string {
	return id === "separation"
		? "Removes the instruments before the sync. The sync uses it when Isolate vocals first is on."
		: `Hears the words of a song in ${LANG_LABELS[id]}.`;
}

/** Stages of a sync in this browser: those of a server job, plus download and load. */
export type BrowserSyncStage = SyncProgressStage;
