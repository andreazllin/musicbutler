import { create } from "zustand";

/** The shape Mantine's `useTree` reads for its expanded state. */
type TreeExpandedState = Record<string, boolean>;

/**
 * UI state of the Lyrics Sync feature (docs/PLAN.md §7.2). Server data stays in
 * TanStack Query and the selected song lives in the URL; only what is left is here:
 * expanded tree nodes, the unsaved editor buffer, the preview offset, the dialog
 * open states and small player settings.
 */
type PendingSwitch = { toPath: string | null } | null;

type LyricsSyncState = {
	/**
	 * Expanded directories, in the shape Mantine's `useTree` reads: library path
	 * to a boolean. The root listing ("") starts expanded.
	 */
	expanded: TreeExpandedState;
	setExpandedState: (state: TreeExpandedState) => void;
	/** Shuts every folder. The root listing stays open, as it does at the start. */
	collapseAllFolders: () => void;

	/** Filter box text; narrows the loaded nodes only (docs/PLAN.md §7.3). */
	treeFilter: string;
	setTreeFilter: (value: string) => void;

	/**
	 * The unsaved editor buffer for `bufferPath`. `null` means "follow the query":
	 * the editor renders the saved content. On the first keystroke the buffer takes over.
	 */
	buffer: string | null;
	bufferPath: string | null;
	setBuffer: (path: string, value: string) => void;
	clearBuffer: () => void;

	/** Preview-time offset in seconds, −5.00 … +5.00 (docs/PLAN.md §7.6). */
	previewOffset: number;
	setPreviewOffset: (seconds: number) => void;

	/** Player settings that survive song switches. */
	volume: number;
	setVolume: (volume: number) => void;
	playbackRate: number;
	setPlaybackRate: (rate: number) => void;

	/** Sync options (docs/PLAN.md §12.4, §12.6). Shared by the dialog and the no-dialog path. */
	isolateVocals: boolean;
	setIsolateVocals: (value: boolean) => void;
	wordTimestamps: boolean;
	setWordTimestamps: (value: boolean) => void;

	/** Dialogs. */
	confirmSyncOpen: boolean;
	setConfirmSyncOpen: (open: boolean) => void;
	/** Set while the app asks "discard unsaved changes?" before switching songs. */
	pendingSwitch: PendingSwitch;
	setPendingSwitch: (value: PendingSwitch) => void;
	conflictOpen: boolean;
	setConflictOpen: (open: boolean) => void;
	deleteOpen: boolean;
	setDeleteOpen: (open: boolean) => void;
};

export const useLyricsSyncStore = create<LyricsSyncState>((set) => ({
	expanded: { "": true },
	setExpandedState: (expanded) => set({ expanded }),
	collapseAllFolders: () => set({ expanded: { "": true } }),

	treeFilter: "",
	setTreeFilter: (treeFilter) => set({ treeFilter }),

	buffer: null,
	bufferPath: null,
	setBuffer: (bufferPath, buffer) => set({ buffer, bufferPath }),
	clearBuffer: () => set({ buffer: null, bufferPath: null }),

	previewOffset: 0,
	setPreviewOffset: (previewOffset) => set({ previewOffset }),

	volume: 1,
	setVolume: (volume) => set({ volume }),
	playbackRate: 1,
	setPlaybackRate: (playbackRate) => set({ playbackRate }),

	isolateVocals: true,
	setIsolateVocals: (isolateVocals) => set({ isolateVocals }),
	wordTimestamps: true,
	setWordTimestamps: (wordTimestamps) => set({ wordTimestamps }),

	confirmSyncOpen: false,
	setConfirmSyncOpen: (confirmSyncOpen) => set({ confirmSyncOpen }),
	pendingSwitch: null,
	setPendingSwitch: (pendingSwitch) => set({ pendingSwitch }),
	conflictOpen: false,
	setConflictOpen: (conflictOpen) => set({ conflictOpen }),
	deleteOpen: false,
	setDeleteOpen: (deleteOpen) => set({ deleteOpen }),
}));
