import type { Lang, SyncMode } from "@musicbutler/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The user's settings (the Settings screen). They are preferences of this
 * browser, not of the library, so they persist in localStorage and never
 * reach the server.
 */
type SettingsState = {
	/**
	 * Where a lyrics sync runs. `browser` is the default: the models run in this
	 * page, so the server only serves the audio and saves the result.
	 */
	syncMode: SyncMode;
	setSyncMode: (mode: SyncMode) => void;

	/**
	 * The language the Lyrics Sync screen selects when it opens. `null` selects
	 * the first language that has a model.
	 */
	defaultLang: Lang | null;
	setDefaultLang: (lang: Lang | null) => void;
};

/** Bump when the shape changes, and give `persist` a `migrate`. */
const VERSION = 1;

export const useSettingsStore = create<SettingsState>()(
	persist(
		(set) => ({
			syncMode: "browser",
			setSyncMode: (syncMode) => set({ syncMode }),
			defaultLang: null,
			setDefaultLang: (defaultLang) => set({ defaultLang }),
		}),
		{
			name: "musicbutler-settings",
			version: VERSION,
			storage: createJSONStorage(() => localStorage),
			partialize: ({ syncMode, defaultLang }) => ({ syncMode, defaultLang }),
		},
	),
);
