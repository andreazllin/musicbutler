/**
 * `src/browser.ts` runs in a Web Worker. One import of a Node built-in, of
 * onnxruntime-node or of the Node build of Transformers.js anywhere below it
 * breaks the web build or fails at run time, so this walks its import graph.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../src");
const ENTRY = resolve(SRC, "browser.ts");
const IMPORT = /(?:import|export)\s[^;]*?from\s+"([^"]+)"/g;
const FORBIDDEN = [/^node:/, /^onnxruntime-node$/, /^@huggingface\/transformers$/, /^bun/];

function graph(entry: string): Map<string, string[]> {
	const seen = new Map<string, string[]>();
	const stack = [entry];
	while (stack.length > 0) {
		const file = stack.pop() as string;
		if (seen.has(file)) continue;
		const specifiers = [...readFileSync(file, "utf8").matchAll(IMPORT)].map((m) => m[1] as string);
		seen.set(file, specifiers);
		for (const s of specifiers) if (s.startsWith(".")) stack.push(resolve(dirname(file), s));
	}
	return seen;
}

describe("browser entry", () => {
	const files = graph(ENTRY);

	test("reaches the pure modules", () => {
		expect(files.size).toBeGreaterThan(8);
	});

	for (const [file, specifiers] of files) {
		test(`${relative(SRC, file)} imports nothing that needs Node`, () => {
			for (const s of specifiers) {
				for (const re of FORBIDDEN) expect(re.test(s), `${s}`).toBe(false);
			}
			expect(readFileSync(file, "utf8").includes("process.")).toBe(false);
		});
	}
});
