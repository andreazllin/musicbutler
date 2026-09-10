/**
 * Server configuration, parsed with Zod (docs/PLAN.md §6.4).
 *
 * `getEnv()` is lazy so that tests can set `process.env.MUSIC_DIR` before the
 * first call. The parsed value is cached and recomputed only when the raw
 * variables change. Filesystem checks go through `fs/library.ts` (§5.3).
 */
import { z } from "zod";
import { isDirectorySync, realpathSync } from "./fs/library.ts";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RAW_KEYS = ["MUSIC_DIR", "MODEL_CACHE_DIR", "PORT", "LOG_LEVEL", "FFMPEG_PATH"] as const;

const envSchema = z.object({
	MUSIC_DIR: z
		.string({ error: "MUSIC_DIR is required: the absolute path of the music library" })
		.min(1, "MUSIC_DIR must not be empty"),
	MODEL_CACHE_DIR: z.string().min(1).default("/models"),
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
	FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
});

export interface Env {
	/** Real (symlink-resolved) absolute path of the library root. */
	readonly MUSIC_DIR: string;
	readonly MODEL_CACHE_DIR: string;
	readonly PORT: number;
	readonly LOG_LEVEL: LogLevel;
	readonly FFMPEG_PATH: string;
}

let cached: { key: string; env: Env } | null = null;

function snapshot(): Record<(typeof RAW_KEYS)[number], string | undefined> {
	const out = {} as Record<(typeof RAW_KEYS)[number], string | undefined>;
	for (const k of RAW_KEYS) {
		const v = process.env[k];
		out[k] = v === "" ? undefined : v;
	}
	return out;
}

export class EnvError extends Error {
	override name = "EnvError";
}

function parse(raw: ReturnType<typeof snapshot>): Env {
	const result = envSchema.safeParse(raw);
	if (!result.success) {
		const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "?"}: ${i.message}`);
		throw new EnvError(`Invalid configuration:\n${lines.join("\n")}`);
	}
	const parsed = result.data;
	if (!isDirectorySync(parsed.MUSIC_DIR)) {
		throw new EnvError(
			`Invalid configuration:\n  MUSIC_DIR: "${parsed.MUSIC_DIR}" does not exist or is not a directory`,
		);
	}
	const env: Env = {
		MUSIC_DIR: realpathSync(parsed.MUSIC_DIR),
		MODEL_CACHE_DIR: parsed.MODEL_CACHE_DIR,
		PORT: parsed.PORT,
		LOG_LEVEL: parsed.LOG_LEVEL,
		FFMPEG_PATH: parsed.FFMPEG_PATH,
	};
	// The alignment engine reads its own variable (docs/PLAN.md §13.14).
	process.env.MUSICBUTLER_CACHE = env.MODEL_CACHE_DIR;
	return env;
}

/** Parsed configuration. Throws `EnvError` with a readable message when a value is wrong. */
export function getEnv(): Env {
	const raw = snapshot();
	const key = JSON.stringify(raw);
	if (cached && cached.key === key) return cached.env;
	const env = parse(raw);
	cached = { key, env };
	return env;
}
