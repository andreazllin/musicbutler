/**
 * Read access to the model cache, for the browser sync (docs/DECISIONS.md,
 * 2026-11-02).
 *
 * This is not the music library, but the filesystem boundary of §5.3 covers
 * every read, so the model files go through here too. Each function takes an
 * absolute path that the caller built from configuration and an allowlist,
 * never from user input.
 */
import { stat } from "node:fs/promises";

export interface ModelFileStat {
	bytes: number;
	mtimeMs: number;
}

/** Size and mtime of one model file, or null when it is absent or not a file. */
export async function statModelFile(absPath: string): Promise<ModelFileStat | null> {
	try {
		const s = await stat(absPath);
		return s.isFile() ? { bytes: s.size, mtimeMs: s.mtimeMs } : null;
	} catch {
		return null;
	}
}

/** The body of one model file. Bun streams it and sets Content-Length. */
export function openModelFile(absPath: string): Blob {
	return Bun.file(absPath);
}
