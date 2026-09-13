#!/usr/bin/env bun
/**
 * Downloads the alignment models into the model cache (docs/PLAN.md §8.3, §9.2).
 *
 *   bun run scripts/fetch-models.ts [--lang en-US,it-IT] [--dir <MODEL_CACHE_DIR>]
 *
 * A language that is already present is skipped, so this is safe to run on
 * every container start. Exit 2 means the language list is wrong. Exit 1 means
 * a download failed.
 *
 * `--dir` sets MUSICBUTLER_CACHE before the engine is imported, so both the
 * Demucs weights and the Transformers.js cache land under that directory
 * (docs/PLAN.md §13.14). Exits non-zero on any failure. `it-IT` is skipped
 * silently when no Italian model id is configured, unless it was requested
 * explicitly with --lang, in which case that is an error.
 */
import { parseArgs } from "node:util";
// Relative imports: the repository root declares no dependency on the workspace packages.
import { LANGS, type Lang } from "../packages/shared/src/index.ts";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: { lang: { type: "string" }, dir: { type: "string" } },
});

if (values.dir) process.env.MUSICBUTLER_CACHE = values.dir;

// Dynamic import: packages/align/src/config.ts reads MUSICBUTLER_CACHE at module load.
const { CACHE_DIR, MODELS, ensureModels, modelsReady } = await import(
	"../packages/align/src/index.ts"
);

const explicit = values.lang !== undefined;
const requested = (values.lang ?? LANGS.join(",")).split(",").map((s) => s.trim());
for (const l of requested) {
	if (!(LANGS as readonly string[]).includes(l)) {
		console.error(`unknown language ${l}; use ${LANGS.join(", ")}`);
		// Exit 2 marks a bad request, which the container entrypoint treats as
		// fatal. Exit 1 is a download that failed, which it only warns about.
		process.exit(2);
	}
}
const langs = requested as Lang[];

console.log(`model cache: ${CACHE_DIR}`);
let failed = false;
for (const lang of langs) {
	const id = MODELS.asr[lang];
	if (!id) {
		if (explicit) {
			console.error(
				`${lang}: no ASR model configured (set MUSICBUTLER_ASR_IT); see packages/align/README.md`,
			);
			failed = true;
		} else {
			console.log(`${lang}: skipped (no ASR model configured)`);
		}
		continue;
	}
	if (await modelsReady(lang)) {
		console.log(`${lang}: already present (${id}, ${MODELS.demucs.file})`);
		continue;
	}
	let last = "";
	let lastFile = "";
	const t0 = performance.now();
	// A TTY gets a live one-line bar; a log (Docker build, CI) gets one line per file.
	const tty = process.stdout.isTTY === true;
	try {
		await ensureModels(lang, (file, received, total) => {
			const pct = total > 0 ? `${Math.floor((received / total) * 100)}%` : `${received} B`;
			const line = `${lang}: ${file} ${pct}`;
			if (tty) {
				if (line !== last) process.stdout.write(`\r${line.padEnd(90)}`);
			} else if (file !== lastFile) {
				console.log(
					`${lang}: downloading ${file}${total > 0 ? ` (${Math.round(total / 1e6)} MB)` : ""}`,
				);
			}
			last = line;
			lastFile = file;
		});
		if (tty) process.stdout.write("\n");
		const ok = await modelsReady(lang);
		console.log(
			`${lang}: ${ok ? "ready" : "INCOMPLETE"} in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
		);
		if (!ok) failed = true;
	} catch (e) {
		if (tty) process.stdout.write("\n");
		console.error(`${lang}: failed: ${e instanceof Error ? e.message : String(e)}`);
		failed = true;
	}
}
process.exit(failed ? 1 : 0);
