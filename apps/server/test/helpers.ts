/**
 * Test support: copies `fixtures/library` into a fresh temp directory and points
 * MUSIC_DIR at it. Tests never mutate the checked-in fixture library.
 *
 * `env.ts` reads `process.env` lazily, so setting the variable here (before the
 * first `getEnv()` call) is enough; no import-order tricks are needed.
 */
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const FIXTURE_LIBRARY = resolve(import.meta.dir, "../../../fixtures/library");

export interface TempLibrary {
	/** Real absolute path of the temp copy (symlinks resolved, as MUSIC_DIR is). */
	dir: string;
	cleanup(): void;
}

export function makeTempLibrary(): TempLibrary {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "musicbutler-lib-")));
	cpSync(FIXTURE_LIBRARY, dir, { recursive: true });
	process.env.MUSIC_DIR = dir;
	process.env.MODEL_CACHE_DIR = join(dir, ".models-cache-for-tests");
	return {
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

export const SONG_MP3 = "Artist One/Album A/01 First Song.mp3";
export const SONG_FLAC = "Artist One/Album A/02 Second Song.flac";
export const SONG_FLAC_LRC = "Artist One/Album A/02 Second Song.lrc";
export const SONG_OGG = "Artist One/Album A/10 Tenth Song.ogg";
export const SONG_M4A = "Artist Two/Single.m4a";
