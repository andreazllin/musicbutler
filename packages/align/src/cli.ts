#!/usr/bin/env bun
/**
 * musicbutler-align CLI (docs/lyrics-sync-functionality-implementation-plan.md §5.12).
 *
 *   sync <audio> <lyrics.txt> [--lang en-US|it-IT] [--out DIR] [--dtype q8|fp32]
 *        [--save-vocals] [--json] [--lrc-spacing original] [--threads N] [--no-separate] [--verbose]
 *   separate <audio> --out vocals.wav [--threads N]
 *   models pull [--lang en-US,it-IT]
 *
 * Uses `util.parseArgs`; no dependency. Prints stage timings to stderr. On an
 * AlignError exits with code 2 and a one-line hint.
 */
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { LANGS, type Lang } from "@musicbutler/shared";
import { writeWav16 } from "./audio/wav.ts";
import { CACHE_DIR, MODELS, ORIGINAL_SR } from "./config.ts";
import { AbortError, AlignError, ensureModels, LyricsSync, wordsToLrc } from "./index.ts";
import type { Dtype, ProgressFn } from "./types.ts";

const USAGE = `usage:
  musicbutler-align sync <audio> <lyrics.txt> [--lang en-US|it-IT] [--out ./output] [--dtype q8|fp32]
                    [--save-vocals] [--json] [--lrc-spacing original] [--threads N] [--no-separate] [--verbose]
  musicbutler-align separate <audio> --out vocals.wav [--threads N]
  musicbutler-align models pull [--lang en-US,it-IT]

models are cached in ${CACHE_DIR} (override with MUSICBUTLER_CACHE)`;

const ALIGN_HINT =
	"alignment failed: try --dtype fp32; check that the lyrics match the audio; check that --lang matches the language of the song (the wrong model gives the same failure)";

function log(msg: string): void {
	process.stderr.write(`${msg}\n`);
}

function fail(msg: string, code = 1): never {
	log(msg);
	process.exit(code);
}

function asLang(v: string | undefined): Lang {
	const lang = v ?? "en-US";
	if (!(LANGS as readonly string[]).includes(lang))
		fail(`unknown --lang ${lang}; use ${LANGS.join(" or ")}`);
	return lang as Lang;
}

function asDtype(v: string | undefined): Dtype {
	const d = v ?? "q8";
	if (d !== "q8" && d !== "fp32") fail(`unknown --dtype ${d}; use q8 or fp32`);
	return d;
}

function asThreads(v: string | undefined): number | undefined {
	if (v === undefined) return undefined;
	const n = Number(v);
	if (!Number.isInteger(n) || n < 1) fail(`--threads must be a positive integer, got ${v}`);
	return n;
}

/** Prints one line per stage with its duration and a progress line at most every 2 s. */
function stageTimer(): { progress: ProgressFn; finish(): void } {
	const t0 = performance.now();
	let cur = "";
	let curStart = t0;
	let lastPrint = 0;
	let finished = false;
	return {
		progress: (stage, done, total) => {
			if (finished) return;
			const now = performance.now();
			if (stage !== cur) {
				if (cur) log(`  ${cur.padEnd(9)} ${((now - curStart) / 1000).toFixed(2)} s`);
				cur = stage;
				curStart = now;
				lastPrint = now;
			}
			if (total > 1 && done < total && now - lastPrint > 2000) {
				log(`  ${stage.padEnd(9)} ${done}/${total}`);
				lastPrint = now;
			}
		},
		finish: () => {
			finished = true;
			const now = performance.now();
			if (cur) log(`  ${cur.padEnd(9)} ${((now - curStart) / 1000).toFixed(2)} s`);
			log(`  total     ${((now - t0) / 1000).toFixed(2)} s`);
		},
	};
}

async function cmdSync(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			lang: { type: "string" },
			out: { type: "string" },
			dtype: { type: "string" },
			"save-vocals": { type: "boolean", default: false },
			json: { type: "boolean", default: false },
			"lrc-spacing": { type: "string" },
			threads: { type: "string" },
			"no-separate": { type: "boolean", default: false },
			verbose: { type: "boolean", default: false },
		},
	});
	const [audio, lyrics] = positionals;
	if (!audio || !lyrics) fail(USAGE);
	if (values["lrc-spacing"] !== undefined && values["lrc-spacing"] !== "original") {
		fail(`--lrc-spacing accepts only "original"`);
	}
	const outDir = values.out ?? "./output";
	const timer = stageTimer();
	const sync = new LyricsSync({
		lang: asLang(values.lang),
		dtype: asDtype(values.dtype),
		threads: asThreads(values.threads),
		saveVocals: values["save-vocals"],
		returnVocals: values.verbose,
		separate: !values["no-separate"],
		outDir,
		onProgress: timer.progress,
	});
	const tLoad = performance.now();
	await sync.load();
	log(`  load      ${((performance.now() - tLoad) / 1000).toFixed(2)} s`);
	const res = await sync.sync(audio, lyrics);
	timer.finish();
	const name = basename(audio, extname(audio));
	if (values["lrc-spacing"] === "original") {
		await Bun.write(
			join(outDir, `${name}.lrc`),
			wordsToLrc(res.words, res.lines, { spacing: "original" }),
		);
	}
	if (values.verbose && res.vocals16k) {
		const em = await sync.emit(res.vocals16k);
		log(`  greedy: ${sync.greedyDecode(em)}`);
	}
	const low = res.words.filter((w) => w.score < 0.1).length;
	log(`  ${res.words.length} words, ${low} with score < 0.1 -> ${join(outDir, `${name}.lrc`)}`);
	if (values.json)
		process.stdout.write(JSON.stringify({ words: res.words, lrc: res.lrc, lines: res.lines }));
	else process.stdout.write(res.lrc);
	await sync.dispose();
}

async function cmdSeparate(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: { out: { type: "string" }, threads: { type: "string" } },
	});
	const [audio] = positionals;
	if (!audio || !values.out) fail(USAGE);
	const timer = stageTimer();
	const sync = new LyricsSync({ threads: asThreads(values.threads), onProgress: timer.progress });
	const tLoad = performance.now();
	await sync.load();
	log(`  load      ${((performance.now() - tLoad) / 1000).toFixed(2)} s`);
	const [l, r] = await sync.separate(audio);
	await writeWav16(values.out, [l, r], ORIGINAL_SR);
	timer.finish();
	log(`  wrote ${values.out}`);
	await sync.dispose();
}

async function cmdModels(args: string[]): Promise<void> {
	const [sub, ...rest] = args;
	if (sub !== "pull") fail(USAGE);
	const { values } = parseArgs({ args: rest, options: { lang: { type: "string" } } });
	const langs = (values.lang ?? "en-US").split(",").map((s) => asLang(s.trim()));
	for (const lang of langs) {
		if (!MODELS.asr[lang])
			fail(`no ASR model is configured for ${lang}; set MUSICBUTLER_ASR_IT (see README)`);
		let last = "";
		await ensureModels(lang, (file, received, total) => {
			const pct = total > 0 ? ` ${Math.floor((received / total) * 100)}%` : "";
			const line = `${file}${pct}`;
			if (line !== last) {
				process.stderr.write(`\r  ${line.padEnd(70)}`);
				last = line;
			}
		});
		log(`\n  ${lang}: ready (${MODELS.asr[lang]} + ${MODELS.demucs.file}) in ${CACHE_DIR}`);
	}
}

async function main(argv: string[]): Promise<void> {
	const [cmd, ...rest] = argv;
	switch (cmd) {
		case "sync":
			return cmdSync(rest);
		case "separate":
			return cmdSeparate(rest);
		case "models":
			return cmdModels(rest);
		default:
			fail(USAGE);
	}
}

try {
	await main(process.argv.slice(2));
} catch (e) {
	if (e instanceof AlignError) fail(`${ALIGN_HINT}\n  (${e.message})`, 2);
	if (e instanceof AbortError) fail("aborted", 130);
	fail(e instanceof Error ? `error: ${e.message}` : `error: ${String(e)}`);
}
