/**
 * Streaming download with resume and progress
 * (docs/lyrics-sync-functionality-implementation-plan.md §5.13).
 */
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { throwIfAborted } from "../types.ts";

export interface EnsureFileOptions {
	expectedBytes?: number;
	onProgress?: (receivedBytes: number, totalBytes: number) => void;
	signal?: AbortSignal;
}

async function sizeOf(path: string): Promise<number | null> {
	try {
		return (await stat(path)).size;
	} catch {
		return null;
	}
}

/** True when `dest` exists (and matches `expectedBytes` when given). No network. */
export async function fileReady(dest: string, expectedBytes?: number): Promise<boolean> {
	const size = await sizeOf(dest);
	if (size === null) return false;
	return expectedBytes === undefined || size === expectedBytes;
}

/**
 * Returns when `dest` exists with the expected size. Otherwise streams `url`
 * to `dest + ".part"` (resuming a previous partial download with a Range
 * request when the server supports it) and renames it on completion.
 */
export async function ensureFile(
	url: string,
	dest: string,
	opts: EnsureFileOptions = {},
): Promise<void> {
	if (await fileReady(dest, opts.expectedBytes)) return;
	throwIfAborted(opts.signal);
	await mkdir(dirname(dest), { recursive: true });
	const part = `${dest}.part`;
	let have = (await sizeOf(part)) ?? 0;
	const headers = new Headers();
	if (process.env.HF_TOKEN) headers.set("Authorization", `Bearer ${process.env.HF_TOKEN}`);
	if (have > 0) headers.set("Range", `bytes=${have}-`);
	const res = await fetch(url, { headers, signal: opts.signal });
	let append = false;
	if (res.status === 206 && have > 0) {
		append = true;
	} else if (res.ok) {
		have = 0;
	} else {
		throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
	}
	if (!res.body) throw new Error(`download failed: empty body for ${url}`);
	const total = (() => {
		const len = Number(res.headers.get("content-length") ?? "0");
		return len > 0 ? have + len : (opts.expectedBytes ?? 0);
	})();
	const existing = append ? await Bun.file(part).arrayBuffer() : null;
	const sink = Bun.file(part).writer();
	if (existing) sink.write(existing);
	let received = have;
	const reader = res.body.getReader();
	try {
		for (;;) {
			throwIfAborted(opts.signal);
			const { done, value } = await reader.read();
			if (done) break;
			sink.write(value);
			received += value.byteLength;
			opts.onProgress?.(received, total);
		}
		await sink.end();
	} catch (e) {
		// `end()` returns number | Promise<number>; normalise before catching.
		await Promise.resolve(sink.end()).catch(() => {});
		if (opts.signal?.aborted) await unlink(part).catch(() => {});
		throw e;
	}
	if (opts.expectedBytes !== undefined && received !== opts.expectedBytes) {
		await unlink(part).catch(() => {});
		throw new Error(
			`download of ${url} ended at ${received} bytes, expected ${opts.expectedBytes}`,
		);
	}
	await rename(part, dest);
}
