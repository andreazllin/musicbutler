/**
 * THE ONLY module that touches the filesystem (docs/PLAN.md §5.3).
 *
 * Every public function that reaches into the music library takes a
 * library-relative path and resolves it through `paths.ts`. The few helpers
 * that take absolute paths (`isDirectorySync`, `realpathSync`, `isWritableDir`,
 * `modelFileExists`) serve `env.ts` and `/healthz` only, never user input.
 */
import { type Dirent, constants as FS, realpathSync as nodeRealpathSync, statSync } from "node:fs";
import {
	access,
	chmod,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	stat,
	unlink,
} from "node:fs/promises";
import { basename, dirname, extname, join, sep } from "node:path";
import {
	type Entry,
	extensionOf,
	isAudioFile,
	LIBRARY_TREE_MAX_NODES,
	type LibraryTree,
	lrcPathFor,
	type TreeEntry,
} from "@musicbutler/shared";
import { TRPCError } from "@trpc/server";
import { getEnv } from "../env.ts";
import { childPath, normalizeLibraryPath, parentOf, resolveLibraryPath } from "./paths.ts";

// ---------------------------------------------------------------------------
// Helpers for env.ts and /healthz (absolute paths that come from configuration)
// ---------------------------------------------------------------------------

export function isDirectorySync(absPath: string): boolean {
	try {
		return statSync(absPath).isDirectory();
	} catch {
		return false;
	}
}

export function realpathSync(absPath: string): string {
	return nodeRealpathSync(absPath);
}

export async function isWritableDir(absPath: string): Promise<boolean> {
	try {
		const s = await stat(absPath);
		if (!s.isDirectory()) return false;
		await access(absPath, FS.W_OK);
		return true;
	} catch {
		return false;
	}
}

/** True when `<MODEL_CACHE_DIR>/<name>` exists. `name` is a bare file name, never a path. */
export async function modelFileExists(name: string): Promise<boolean> {
	if (name !== basename(name)) throw new Error("modelFileExists expects a bare file name");
	try {
		const s = await stat(join(getEnv().MODEL_CACHE_DIR, name));
		return s.isFile();
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Directory listing (docs/PLAN.md §5.5, §6.2)
// ---------------------------------------------------------------------------

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function isHiddenName(name: string): boolean {
	return name.startsWith(".") || name === "@eaDir";
}

type Kind = "dir" | "audio" | "hidden";

function errCode(err: unknown): string | undefined {
	return typeof err === "object" && err !== null && "code" in err
		? String((err as { code?: unknown }).code)
		: undefined;
}

/**
 * Classifies one directory entry. Symlinks are followed with `stat`; a symlink
 * that resolves outside the library is hidden, because every later access to
 * it would be rejected anyway.
 */
async function classify(dirAbs: string, d: Dirent): Promise<Kind> {
	if (isHiddenName(d.name)) return "hidden";
	let isDir = d.isDirectory();
	let isFile = d.isFile();
	if (d.isSymbolicLink()) {
		const abs = join(dirAbs, d.name);
		try {
			const real = await realpath(abs);
			const root = getEnv().MUSIC_DIR;
			if (real !== root && !real.startsWith(root + sep)) return "hidden";
			const s = await stat(abs);
			isDir = s.isDirectory();
			isFile = s.isFile();
		} catch {
			return "hidden";
		}
	}
	if (isDir) return "dir";
	if (isFile && isAudioFile(d.name)) return "audio";
	return "hidden";
}

async function countVisible(dirAbs: string): Promise<number> {
	let dirents: Dirent[];
	try {
		dirents = await readdir(dirAbs, { withFileTypes: true });
	} catch {
		return 0;
	}
	const kinds = await Promise.all(dirents.map((d) => classify(dirAbs, d)));
	return kinds.filter((k) => k !== "hidden").length;
}

export interface Listing {
	path: string;
	parent: string | null;
	entries: Entry[];
}

/** Lists one directory. Never recurses deeper than one `readdir` per child directory. */
export async function listDir(rel: string): Promise<Listing> {
	const path = normalizeLibraryPath(rel);
	const abs = await resolveLibraryPath(path);
	const dirents = await readdir(abs, { withFileTypes: true });
	const names = new Set(dirents.map((d) => d.name));

	const dirs: Extract<Entry, { kind: "dir" }>[] = [];
	const audio: Extract<Entry, { kind: "audio" }>[] = [];

	await Promise.all(
		dirents.map(async (d) => {
			const kind = await classify(abs, d);
			if (kind === "hidden") return;
			const entryAbs = join(abs, d.name);
			const entryPath = childPath(path, d.name);
			if (kind === "dir") {
				dirs.push({
					kind: "dir",
					name: d.name,
					path: entryPath,
					childCount: await countVisible(entryAbs),
				});
				return;
			}
			const s = await stat(entryAbs);
			audio.push({
				kind: "audio",
				name: d.name,
				path: entryPath,
				ext: extensionOf(d.name),
				sizeBytes: s.size,
				mtimeMs: s.mtimeMs,
				hasLrc: names.has(basename(lrcPathFor(d.name))),
			});
		}),
	);

	dirs.sort((a, b) => collator.compare(a.name, b.name));
	audio.sort((a, b) => collator.compare(a.name, b.name));
	return { path, parent: parentOf(path), entries: [...dirs, ...audio] };
}

/**
 * Walks the whole library so the web tree can hold it and search it at once.
 *
 * Cheaper per entry than `listDir`, because the tree draws neither size nor
 * mtime: a plain file costs no `stat` at all. Three things keep the walk
 * bounded. Directories are visited one at a time, so the open descriptors stay
 * to one `readdir` rather than one per directory in the library. A directory
 * whose real path was already visited is skipped, which is what stops a symlink
 * back to an ancestor from looping. And the node count stops at
 * `LIBRARY_TREE_MAX_NODES`, reported as `truncated` so the UI can say the list
 * is short rather than pretending it is whole.
 */
export async function scanTree(): Promise<LibraryTree> {
	const seen = new Set<string>();
	let count = 0;
	let truncated = false;

	async function walk(rel: string, abs: string): Promise<TreeEntry[]> {
		let real: string;
		try {
			real = await realpath(abs);
		} catch {
			return [];
		}
		if (seen.has(real)) return [];
		seen.add(real);

		let dirents: Dirent[];
		try {
			dirents = await readdir(abs, { withFileTypes: true });
		} catch {
			// An unreadable folder is left out rather than failing the whole walk.
			return [];
		}
		const names = new Set(dirents.map((d) => d.name));

		const dirs: Extract<TreeEntry, { kind: "dir" }>[] = [];
		const audio: Extract<TreeEntry, { kind: "audio" }>[] = [];

		// Classification runs across the directory at once; the recursion below
		// does not, so the parallelism stays inside a single directory.
		const kinds = await Promise.all(dirents.map((d) => classify(abs, d)));

		for (const [i, d] of dirents.entries()) {
			if (kinds[i] === "hidden") continue;
			if (count >= LIBRARY_TREE_MAX_NODES) {
				truncated = true;
				break;
			}
			count += 1;
			const entryPath = childPath(rel, d.name);
			if (kinds[i] === "dir") {
				dirs.push({ kind: "dir", name: d.name, path: entryPath, children: [] });
			} else {
				audio.push({
					kind: "audio",
					name: d.name,
					path: entryPath,
					ext: extensionOf(d.name),
					hasLrc: names.has(basename(lrcPathFor(d.name))),
				});
			}
		}

		for (const dir of dirs) {
			if (count >= LIBRARY_TREE_MAX_NODES) {
				truncated = true;
				break;
			}
			dir.children = await walk(dir.path, join(abs, dir.name));
		}

		dirs.sort((a, b) => collator.compare(a.name, b.name));
		audio.sort((a, b) => collator.compare(a.name, b.name));
		return [...dirs, ...audio];
	}

	const rootAbs = await resolveLibraryPath("");
	const children = await walk("", rootAbs);
	return { children, count, truncated };
}

// ---------------------------------------------------------------------------
// .lrc read / write / delete (docs/PLAN.md §5.1, §5.2, §5.4)
// ---------------------------------------------------------------------------

function notFound(): TRPCError {
	return new TRPCError({ code: "NOT_FOUND", message: "Not found" });
}

function badRequest(message: string): TRPCError {
	return new TRPCError({ code: "BAD_REQUEST", message });
}

/**
 * Resolves an audio file and the absolute path of its `.lrc` sibling. The audio
 * file must exist and be a regular file; the `.lrc` may or may not exist.
 * The `.lrc` lives next to the path the user sees, not next to a symlink target.
 */
async function resolveAudioAndLrc(audioRel: string): Promise<{
	audioRelNorm: string;
	audioAbs: string;
	lrcRel: string;
	lrcAbs: string;
}> {
	const audioRelNorm = normalizeLibraryPath(audioRel);
	if (!isAudioFile(audioRelNorm)) throw badRequest("Not an audio file");
	const audioAbs = await resolveLibraryPath(audioRelNorm);
	const s = await stat(audioAbs);
	if (!s.isFile()) throw notFound();
	const lrcRel = lrcPathFor(audioRelNorm);
	const lrcAbs = await resolveLibraryPath(lrcRel);
	return { audioRelNorm, audioAbs, lrcRel, lrcAbs };
}

export interface LrcFile {
	lrcPath: string;
	exists: boolean;
	content: string;
	mtimeMs: number | null;
}

export async function readLrc(audioRel: string): Promise<LrcFile> {
	const { lrcRel, lrcAbs } = await resolveAudioAndLrc(audioRel);
	try {
		const [buf, s] = await Promise.all([readFile(lrcAbs), stat(lrcAbs)]);
		if (!s.isFile()) throw notFound();
		return { lrcPath: lrcRel, exists: true, content: buf.toString("utf8"), mtimeMs: s.mtimeMs };
	} catch (err) {
		if (errCode(err) === "ENOENT") {
			return { lrcPath: lrcRel, exists: false, content: "", mtimeMs: null };
		}
		throw err;
	}
}

/** Returns the current mtime of the `.lrc` for an audio file, or null when it does not exist. */
export async function lrcMtime(audioRel: string): Promise<number | null> {
	const { lrcAbs } = await resolveAudioAndLrc(audioRel);
	try {
		const s = await stat(lrcAbs);
		return s.isFile() ? s.mtimeMs : null;
	} catch (err) {
		if (errCode(err) === "ENOENT") return null;
		throw err;
	}
}

/** UTF-8 without BOM, LF endings, exactly one trailing newline (§5.2). */
export function canonicalizeLrcContent(content: string): string {
	let text = content.startsWith("﻿") ? content.slice(1) : content;
	text = text.replace(/\r\n?/g, "\n");
	text = text.replace(/\n+$/, "");
	return `${text}\n`;
}

/**
 * Atomic write: `<base>.lrc.tmp-<random>` in the same directory, fsync, rename
 * over the target, mode 0644. Returns the new mtimeMs.
 */
export async function writeLrcAtomic(audioRel: string, content: string): Promise<number> {
	const { lrcAbs } = await resolveAudioAndLrc(audioRel);
	const dir = dirname(lrcAbs);
	const random = Math.random().toString(36).slice(2, 10);
	const tmp = join(dir, `${basename(lrcAbs)}.tmp-${random}`);
	const data = Buffer.from(canonicalizeLrcContent(content), "utf8");
	try {
		const fh = await open(tmp, "w", 0o644);
		try {
			await fh.writeFile(data);
			await fh.sync();
		} finally {
			await fh.close();
		}
		await chmod(tmp, 0o644);
		await rename(tmp, lrcAbs);
	} catch (err) {
		await unlink(tmp).catch(() => undefined);
		throw err;
	}
	const s = await stat(lrcAbs);
	return s.mtimeMs;
}

/**
 * Deletion guard (§5.4). `rel` is the library-relative path of the file to
 * delete. Immediately before unlinking it asserts that the target ends with
 * `.lrc` and that a real audio file with the same base name exists in the same
 * directory. Anything else is a bug, so it throws a plain Error.
 */
export async function unlinkLrcGuarded(rel: string): Promise<void> {
	const normalized = normalizeLibraryPath(rel);
	const abs = await resolveLibraryPath(normalized);
	if (extname(abs) !== ".lrc") {
		throw new Error("Deletion guard: refusing to delete a file that is not an .lrc");
	}
	const base = basename(abs, ".lrc");
	const dir = dirname(abs);
	const siblings = await readdir(dir, { withFileTypes: true });
	let hasAudio = false;
	for (const d of siblings) {
		if (!isAudioFile(d.name)) continue;
		if (basename(d.name, extname(d.name)) !== base) continue;
		let isFile = d.isFile();
		if (d.isSymbolicLink()) {
			try {
				isFile = (await stat(join(dir, d.name))).isFile();
			} catch {
				isFile = false;
			}
		}
		if (isFile) {
			hasAudio = true;
			break;
		}
	}
	if (!hasAudio) {
		throw new Error("Deletion guard: refusing to delete an .lrc that has no matching audio file");
	}
	await unlink(abs);
}

/** Deletes the `.lrc` that belongs to an audio file, through the deletion guard. */
export async function deleteLrc(audioRel: string): Promise<void> {
	const { lrcRel } = await resolveAudioAndLrc(audioRel);
	await unlinkLrcGuarded(lrcRel);
}

// ---------------------------------------------------------------------------
// Streaming (docs/PLAN.md §6.3)
// ---------------------------------------------------------------------------

export interface StreamSource {
	/** Lazily opened; the caller slices it for Range requests. */
	file: ReturnType<typeof Bun.file>;
	size: number;
	mtimeMs: number;
	/** Lower-case extension with the dot. */
	ext: string;
}

/** Opens an audio file for `GET /media/stream`. Non-audio names are reported as NOT_FOUND. */
export async function openAudioForStream(rel: string): Promise<StreamSource> {
	const normalized = normalizeLibraryPath(rel);
	if (!isAudioFile(normalized)) throw notFound();
	const abs = await resolveLibraryPath(normalized);
	const s = await stat(abs);
	if (!s.isFile()) throw notFound();
	return { file: Bun.file(abs), size: s.size, mtimeMs: s.mtimeMs, ext: extensionOf(normalized) };
}
