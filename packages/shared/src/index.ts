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

/** Events yielded by the `sync.progress` subscription (docs/PLAN.md §6.2). */
export type SyncEvent =
	| { type: "progress"; stage: SyncStage; pct: number; message?: string }
	| { type: "done"; content: string; mtimeMs: number }
	| { type: "error"; code: string; message: string };
