/** Playback speeds offered by the sync checker (docs/PLAN.md §7.6). */
export const PLAYBACK_RATES = [0.75, 1, 1.25] as const;

/** Seek step for ← and → while the player holds focus, in seconds. */
export const SEEK_STEP_SECONDS = 2;

/** Preview offset range and step (docs/PLAN.md §7.6). */
export const OFFSET_MIN_SECONDS = -5;
export const OFFSET_MAX_SECONDS = 5;
export const OFFSET_STEP_SECONDS = 0.01;

/** Auto-scroll of the lyric preview pauses this long after a manual scroll. */
export const AUTOSCROLL_SUSPEND_MS = 3000;

/** nuqs key that holds the selected audio path in the URL (docs/PLAN.md §13.6). */
export const SONG_QUERY_KEY = "song";

/** Labels for the stages of a sync job. */
export const SYNC_STAGE_LABELS = {
	queued: "Queued",
	decode: "Decoding audio",
	separate: "Isolating vocals",
	transcribe: "Listening",
	align: "Aligning lyrics",
	write: "Writing .lrc",
} as const;
