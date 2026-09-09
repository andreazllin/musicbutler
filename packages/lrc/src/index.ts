/**
 * LRC parsing, serializing, detection, shifting and validation
 * (docs/PLAN.md §5.6, §7.4, §7.5, §7.6, §8.2). Pure TypeScript, zero
 * dependencies, no DOM: runs in Bun and in the browser.
 */
export { hasTimestamps } from "./detect.ts";
export { parse } from "./parse.ts";
export { serialize } from "./serialize.ts";
export { shiftTimestamps } from "./shift.ts";
export { stripToPlainLyrics } from "./strip.ts";
export { formatTime, parseTime } from "./time.ts";
export type { Diagnostic, Line, LrcDocument, MetaTag, WordTime } from "./types.ts";
export { validate } from "./validate.ts";
