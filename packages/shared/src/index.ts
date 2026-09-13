/**
 * Cross-cutting constants and types shared by the server, the web app and the
 * alignment engine. This package has zero dependencies and no runtime side
 * effects. See docs/PLAN.md §2 and §5.5.
 */

/** Audio extensions the library tree shows (docs/PLAN.md §5.5). Lower case, with the dot. */
export const AUDIO_EXTENSIONS = [
	".mp3",
	".flac",
	".m4a",
	".aac",
	".ogg",
	".opus",
	".oga",
	".wav",
	".wv",
	".wma",
	".aiff",
	".aif",
	".ape",
	".mpc",
	".dsf",
] as const;

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

const AUDIO_EXTENSION_SET: ReadonlySet<string> = new Set<string>(AUDIO_EXTENSIONS);

/** Returns the lower-cased extension (with the dot) of a file name, or "" when it has none. */
export function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	// A leading dot marks a dotfile, not an extension.
	if (dot <= 0) return "";
	return name.slice(dot).toLowerCase();
}

/** True when the file name ends with a supported audio extension, regardless of case. */
export function isAudioFile(name: string): name is `${string}${AudioExtension}` {
	return AUDIO_EXTENSION_SET.has(extensionOf(name));
}

/** MIME type per extension for `GET /media/stream` (docs/PLAN.md §6.3). */
export const AUDIO_MIME_TYPES: Record<AudioExtension, string> = {
	".mp3": "audio/mpeg",
	".flac": "audio/flac",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".ogg": "audio/ogg",
	".opus": "audio/ogg",
	".oga": "audio/ogg",
	".wav": "audio/wav",
	".wv": "audio/x-wavpack",
	".wma": "audio/x-ms-wma",
	".aiff": "audio/aiff",
	".aif": "audio/aiff",
	".ape": "audio/x-ape",
	".mpc": "audio/x-musepack",
	".dsf": "audio/x-dsf",
};

/**
 * A path relative to the library root, POSIX separators, no leading slash
 * (docs/PLAN.md §5.3). The empty string is the root itself.
 */
export type LibraryPath = string;

/** For `<dir>/<base>.<ext>` the lyrics file is exactly `<dir>/<base>.lrc` (docs/PLAN.md §5.1). */
export function lrcPathFor(audioPath: LibraryPath): LibraryPath {
	const slash = audioPath.lastIndexOf("/");
	const name = audioPath.slice(slash + 1);
	const dot = name.lastIndexOf(".");
	const base = dot > 0 ? name.slice(0, dot) : name;
	return `${audioPath.slice(0, slash + 1)}${base}.lrc`;
}

/**
 * One node of the whole-library tree (`library.tree`). It carries only what the
 * tree draws: no size and no mtime, which keeps a large library's payload down.
 */
export type TreeEntry =
	| { kind: "dir"; name: string; path: LibraryPath; children: TreeEntry[] }
	| { kind: "audio"; name: string; path: LibraryPath; ext: string; hasLrc: boolean };

/**
 * The whole library in one response. `truncated` is set when the walk stopped at
 * `LIBRARY_TREE_MAX_NODES`, so the UI can say the list is incomplete rather than
 * quietly showing part of it.
 */
export type LibraryTree = {
	children: TreeEntry[];
	count: number;
	truncated: boolean;
};

/**
 * Ceiling on the nodes one `library.tree` walk returns. A library past this is
 * unusual, and the cap is what stops an enormous or looping directory from
 * holding the event loop and the response open.
 */
export const LIBRARY_TREE_MAX_NODES = 50_000;

/** One row of `library.list` (docs/PLAN.md §6.2). */
export type Entry =
	| { kind: "dir"; name: string; path: LibraryPath; childCount: number }
	| {
			kind: "audio";
			name: string;
			path: LibraryPath;
			ext: string;
			sizeBytes: number;
			mtimeMs: number;
			hasLrc: boolean;
	  };

/** Sources the app can import lyrics from. */
export const LYRICS_PROVIDERS = ["lrclib", "genius", "azlyrics"] as const;
export type LyricsProvider = (typeof LYRICS_PROVIDERS)[number];

export const LYRICS_PROVIDER_LABELS: Record<LyricsProvider, string> = {
	lrclib: "LRCLIB",
	genius: "Genius",
	azlyrics: "AZLyrics",
};

/**
 * One result of a lyrics search. It holds no words: a search returns many rows
 * and most are never used, so the text comes from a second call for the one row
 * the user picks.
 */
export type LyricsCandidate = {
	provider: LyricsProvider;
	/** Identifier inside the provider. Give it back to `lyrics.fetch`. */
	id: string;
	title: string;
	artist: string;
	album?: string;
	durationSec?: number;
	/** True when the provider holds timestamps, so the sync step can be skipped. */
	synced: boolean;
	/** Page a person can open. Genius always has one. */
	url?: string;
};

/** The words of one candidate. */
export type LyricsFetchResult = {
	provider: LyricsProvider;
	id: string;
	/** Lyrics with no timestamps, one line per line. */
	plain: string;
	/** LRC text with timestamps, when the provider has it. */
	synced: string | null;
};

/** Rows one search returns, per provider. More than this is noise. */
export const LYRICS_SEARCH_LIMIT = 12;

/** Languages the alignment engine knows about (docs/PLAN.md §13.13). */
export const LANGS = ["en-US", "it-IT"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = {
	"en-US": "English",
	"it-IT": "Italiano",
};

/** Stages of one sync job, in the order they run (docs/PLAN.md §6.2). */
export const SYNC_STAGES = [
	"queued",
	"decode",
	"separate",
	"transcribe",
	"align",
	"write",
] as const;
export type SyncStage = (typeof SYNC_STAGES)[number];

/**
 * State of one job in the queue. A job is `queued` until the runner takes it,
 * then `running`, then one of the three terminal states.
 */
export const JOB_STATUSES = ["queued", "running", "done", "error", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** True while the job still holds a place in the queue. */
export function isActiveJob(status: JobStatus): boolean {
	return status === "queued" || status === "running";
}

/**
 * One row of `jobs.list`. It carries what the queue screen draws and nothing
 * else: the lyric text and the aligned result stay on the `sync.progress`
 * stream, because a job list must not grow with the size of the lyrics.
 */
export type JobSummary = {
	id: string;
	audioPath: LibraryPath;
	lang: Lang;
	status: JobStatus;
	stage: SyncStage;
	pct: number;
	message?: string;
	/** Milliseconds since epoch. */
	createdAt: number;
	/** Set when the runner took the job out of the queue, else null. */
	startedAt: number | null;
	/** Set when the job reached a terminal state, else null. */
	finishedAt: number | null;
	/** Set on `error` and `cancelled`. */
	error?: string;
};

/**
 * Ceiling on jobs waiting in the queue. The queue is in memory and dies with
 * the process, so a caller that queues without limit only builds a backlog it
 * cannot finish.
 */
export const MAX_QUEUED_JOBS = 100;

/** Events yielded by the `sync.progress` subscription (docs/PLAN.md §6.2). */
export type SyncEvent =
	| { type: "progress"; stage: SyncStage; pct: number; message?: string }
	| { type: "done"; content: string; mtimeMs: number }
	| { type: "error"; code: string; message: string };
