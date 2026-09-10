/** Minimal leveled logger. Respects `LOG_LEVEL` (docs/PLAN.md §6.4). */
import { getEnv, LOG_LEVELS, type LogLevel } from "./env.ts";

function enabled(level: LogLevel): boolean {
	let threshold: LogLevel = "info";
	try {
		threshold = getEnv().LOG_LEVEL;
	} catch {
		// Configuration is broken; log everything so the boot error is visible.
		threshold = "debug";
	}
	return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);
}

function write(level: LogLevel, msg: string, extra?: unknown): void {
	if (!enabled(level)) return;
	const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
	const sink = level === "error" || level === "warn" ? console.error : console.log;
	if (extra === undefined) sink(line);
	else sink(line, extra);
}

export const log = {
	debug: (msg: string, extra?: unknown) => write("debug", msg, extra),
	info: (msg: string, extra?: unknown) => write("info", msg, extra),
	warn: (msg: string, extra?: unknown) => write("warn", msg, extra),
	error: (msg: string, extra?: unknown) => write("error", msg, extra),
};
