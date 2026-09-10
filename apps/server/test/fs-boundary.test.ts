/**
 * docs/PLAN.md §5.3: only `apps/server/src/fs/**` may touch the filesystem.
 * Biome's `noRestrictedImports` guards the `node:fs` imports; this test also
 * guards the `Bun.file` / `Bun.write` globals, which no lint rule can restrict.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../src");
const FS_DIR = join(SRC, "fs");

function walk(dir: string, out: string[] = []): string[] {
	for (const d of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, d.name);
		if (d.isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|js|mjs)$/.test(d.name)) out.push(p);
	}
	return out;
}

const FORBIDDEN = ["Bun.file(", "Bun.write(", "node:fs", 'from "fs'];

describe("filesystem boundary", () => {
	const files = walk(SRC).filter((f) => !f.startsWith(`${FS_DIR}/`));

	test("scans a meaningful set of files", () => {
		expect(files.length).toBeGreaterThan(5);
	});

	for (const file of files) {
		test(`${relative(SRC, file)} does not touch the filesystem`, () => {
			const text = readFileSync(file, "utf8");
			for (const needle of FORBIDDEN) {
				expect(text.includes(needle), `${relative(SRC, file)} contains ${needle}`).toBe(false);
			}
		});
	}
});
