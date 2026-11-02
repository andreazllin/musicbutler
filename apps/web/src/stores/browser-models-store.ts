import type { BrowserModel, BrowserModelId } from "@musicbutler/shared";
import { create } from "zustand";
import type { ModelRecord } from "@/features/browser-sync/helpers/local-state";
import {
	type DownloadProgress,
	deleteLocalModel,
	downloadModel,
	listLocalModels,
} from "@/features/browser-sync/lib/model-store";

type Download = DownloadProgress & { error?: string };

/**
 * The models this browser holds, and the downloads in progress. The Settings
 * screen and the sync runner share it, so a download that a sync starts shows
 * on the Settings screen too, and leaving the screen does not stop it.
 */
type BrowserModelsState = {
	/** Complete models in IndexedDB, by id. Empty until `refresh` resolves. */
	local: Partial<Record<BrowserModelId, ModelRecord>>;
	/** True once the first `refresh` finished. */
	isLoaded: boolean;
	downloads: Partial<Record<BrowserModelId, Download>>;
	refresh: () => Promise<void>;
	/** Resolves when the model is stored. Joins a download that already runs. */
	download: (model: BrowserModel) => Promise<void>;
	cancelDownload: (id: BrowserModelId) => void;
	remove: (model: BrowserModel) => Promise<void>;
};

const controllers = new Map<BrowserModelId, AbortController>();
const inFlight = new Map<BrowserModelId, Promise<void>>();

export const useBrowserModelsStore = create<BrowserModelsState>((set, get) => ({
	local: {},
	isLoaded: false,
	downloads: {},

	refresh: async () => {
		const records = await listLocalModels();
		set({ local: Object.fromEntries(records.map((r) => [r.id, r])), isLoaded: true });
	},

	download: (model) => {
		const running = inFlight.get(model.id);
		if (running) return running;
		// Ask the browser not to evict the models when space runs low. It may say no.
		void navigator.storage?.persist?.().catch(() => false);
		const controller = new AbortController();
		controllers.set(model.id, controller);
		const setDownload = (value: Download | undefined) =>
			set((s) => ({ downloads: { ...s.downloads, [model.id]: value } }));
		const promise = downloadModel(model, setDownload, controller.signal)
			.then(
				() => setDownload(undefined),
				(err: unknown) => {
					const aborted = controller.signal.aborted;
					setDownload(
						aborted
							? undefined
							: {
									received: 0,
									total: model.bytes,
									error: err instanceof Error ? err.message : "The download failed.",
								},
					);
					throw err;
				},
			)
			.finally(() => {
				controllers.delete(model.id);
				inFlight.delete(model.id);
				void get().refresh();
			});
		inFlight.set(model.id, promise);
		return promise;
	},

	cancelDownload: (id) => controllers.get(id)?.abort(),

	remove: async (model) => {
		controllers.get(model.id)?.abort();
		await deleteLocalModel(model);
		await get().refresh();
	},
}));
