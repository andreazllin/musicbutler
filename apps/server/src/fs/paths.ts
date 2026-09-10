/**
 * THE ONLY module that turns a library-relative path into an absolute path
 * (docs/PLAN.md §5.3).
 *
 * A library path uses POSIX separators, has no leading slash, and is relative
 * to MUSIC_DIR. The empty string is the root.
 */
import { realpath } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import posix from "node:path/posix";
import { TRPCError } from "@trpc/server";
import { getEnv } from "../env.ts";

/** Generic on purpose: the message must never repeat the input (§5.3). */
export const FORBIDDEN_MESSAGE = "Path is outside the music library";

function forbidden(): TRPCError {
	return new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_MESSAGE });
}

function isEnoent(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		((err as { code?: unknown }).code === "ENOENT" ||
			(err as { code?: unknown }).code === "ENOTDIR")
	);
}

/**
 * Syntactic validation and normalization. Returns the canonical relative path
 * ("" for the root). Throws FORBIDDEN for NUL bytes, backslashes, a leading
 * slash, or any `..` segment left after `path.posix.normalize`.
 */
export function normalizeLibraryPath(rel: string): string {
	if (rel.includes("\0") || rel.includes("\\")) throw forbidden();
	if (rel.startsWith("/")) throw forbidden();
	if (rel === "" || rel === ".") return "";
	// Stricter than the letter of §5.3: a `..` segment is never a legitimate name,
	// so reject it before normalization too ("A/.." would otherwise collapse to the root).
	for (const segment of rel.split("/")) if (segment === "..") throw forbidden();
	let normalized = posix.normalize(rel);
	while (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
	if (normalized === "." || normalized === "") return "";
	if (normalized.startsWith("/")) throw forbidden();
	for (const segment of normalized.split("/")) {
		if (segment === ".." || segment === "") throw forbidden();
	}
	return normalized;
}

function assertInside(absReal: string, root: string): void {
	if (absReal !== root && !absReal.startsWith(root + sep)) throw forbidden();
}

/**
 * Resolves a library-relative path to a real absolute path inside MUSIC_DIR.
 *
 * When the leaf does not exist yet (an `.lrc` about to be created) the parent
 * directory is resolved with `realpath` and the base name is re-appended. When
 * the parent does not exist either, the underlying ENOENT error propagates so
 * the caller can map it to NOT_FOUND.
 *
 * Throws TRPCError FORBIDDEN, without echoing the input, for anything that
 * resolves outside the library (including through a symlink).
 */
export async function resolveLibraryPath(rel: string): Promise<string> {
	const root = getEnv().MUSIC_DIR;
	const normalized = normalizeLibraryPath(rel);
	const abs = normalized === "" ? root : join(root, ...normalized.split("/"));
	try {
		const real = await realpath(abs);
		assertInside(real, root);
		return real;
	} catch (err) {
		if (!isEnoent(err) || abs === root) throw err;
	}
	// Missing leaf: resolve the parent and re-append the base name.
	const realParent = await realpath(dirname(abs));
	assertInside(realParent, root);
	const result = join(realParent, basename(abs));
	assertInside(result, root);
	return result;
}

/** The library-relative parent of a normalized path, or null for the root. */
export function parentOf(normalized: string): string | null {
	if (normalized === "") return null;
	const parent = posix.dirname(normalized);
	return parent === "." ? "" : parent;
}

/** Joins a normalized library path and a child name. */
export function childPath(normalizedDir: string, name: string): string {
	return normalizedDir === "" ? name : `${normalizedDir}/${name}`;
}
