/**
 * §6 M5/M7 end-to-end on the `say` fixtures. Gated behind MUSICBUTLER_E2E=1:
 * it loads the Demucs and wav2vec2 models (downloading them when absent) and
 * needs ffmpeg. Skips a language whose model id is empty.
 *
 * The fixture is speech, not singing (§7.10). It validates the plumbing and
 * the aligner, not singing accuracy.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGS } from "@musicbutler/shared";
import { decodeToF32 } from "../src/audio/ffmpeg.ts";
import { ASR_FRAME_SEC, MODELS, ORIGINAL_SR } from "../src/config.ts";
import { AbortError, AlignError, availableLangs, LyricsSync, modelsReady } from "../src/index.ts";

const E2E = process.env.MUSICBUTLER_E2E === "1";
const FIXTURES = join(import.meta.dir, "..", "fixtures", "say");
const DIRS = { "en-US": "en", "it-IT": "it" } as const;

const instances: LyricsSync[] = [];
afterAll(async () => {
	for (const s of instances) await s.dispose();
});

describe.skipIf(!E2E)("e2e (MUSICBUTLER_E2E=1)", () => {
	for (const lang of LANGS) {
		const modelId = MODELS.asr[lang];
		const dir = join(FIXTURES, DIRS[lang]);
		const audio = join(dir, "speech.wav");
		const lyricsPath = join(dir, "lyrics.txt");
		const skip = modelId === "" || !existsSync(audio);

		describe.skipIf(skip)(lang, () => {
			test("sync aligns every word of the fixture", async () => {
				const lyrics = await Bun.file(lyricsPath).text();
				const expectedWords = lyrics.split(/\s+/).filter((w) => w !== "").length;
				const [l] = await decodeToF32(audio, { sampleRate: ORIGINAL_SR, channels: 1 });
				const durationSec = (l as Float32Array).length / ORIGINAL_SR;

				const events: string[] = [];
				const timings: Record<string, number> = {};
				let stageStart = performance.now();
				let lastStage = "";
				const sync = new LyricsSync({
					lang,
					saveVocals: true,
					onProgress: (stage, done, total) => {
						events.push(`${stage}:${done}/${total}`);
						if (stage !== lastStage) {
							if (lastStage) timings[lastStage] = performance.now() - stageStart;
							stageStart = performance.now();
							lastStage = stage;
						}
					},
				});
				instances.push(sync);
				const t0 = performance.now();
				await sync.load();
				const loadMs = performance.now() - t0;
				const t1 = performance.now();
				const res = await sync.sync(audio, lyricsPath);
				timings[lastStage] = performance.now() - stageStart;
				const syncMs = performance.now() - t1;

				// M4 numbers on the fixture.
				const em = await sync.emit(res.vocals16k as Float32Array);
				const expectedFrames = Math.round(durationSec / ASR_FRAME_SEC);
				expect(Math.abs(em.frames - expectedFrames)).toBeLessThanOrEqual(
					5 + 2 * Math.ceil(durationSec / 15),
				);
				for (let f = 1; f < em.frames; f++) {
					expect((em.frameTimes[f] as number) > (em.frameTimes[f - 1] as number)).toBe(true);
				}
				for (let f = 0; f < em.frames; f += 97) {
					let sum = 0;
					for (let c = 0; c < em.classes; c++)
						sum += Math.exp(em.logProbs[f * em.classes + c] as number);
					expect(Math.abs(sum - 1)).toBeLessThan(1e-3);
				}
				const greedy = sync.greedyDecode(em);

				console.log(
					`[e2e ${lang}] model=${modelId} duration=${durationSec.toFixed(2)}s frames=${em.frames} (expected≈${expectedFrames}) classes=${em.classes}`,
				);
				console.log(`[e2e ${lang}] greedy: ${greedy}`);
				console.log(
					`[e2e ${lang}] load=${(loadMs / 1000).toFixed(2)}s sync=${(syncMs / 1000).toFixed(2)}s ` +
						Object.entries(timings)
							.map(([k, v]) => `${k}=${(v / 1000).toFixed(2)}s`)
							.join(" "),
				);
				console.log(`[e2e ${lang}] lrc:\n${res.lrc.split("\n").slice(0, 4).join("\n")}`);

				// M5 assertions.
				expect(res.words.length).toBe(expectedWords);
				expect(res.lines.length).toBe(lyrics.split(/\r?\n/).length);
				for (let i = 1; i < res.words.length; i++) {
					expect((res.words[i] as { start: number }).start).toBeGreaterThanOrEqual(
						(res.words[i - 1] as { start: number }).start,
					);
				}
				for (const w of res.words) {
					expect(w.start).toBeGreaterThanOrEqual(0);
					expect(w.end).toBeGreaterThanOrEqual(w.start);
					expect(w.end).toBeLessThanOrEqual(durationSec + ASR_FRAME_SEC);
				}
				const mean = res.words.reduce((a, w) => a + w.score, 0) / res.words.length;
				console.log(`[e2e ${lang}] mean score=${mean.toFixed(3)}`);
				expect(mean).toBeGreaterThan(0.3);
				// Progress fired at every stage boundary and per chunk / window.
				for (const stage of ["decode", "separate", "emit", "align", "write"]) {
					expect(events.some((e) => e.startsWith(`${stage}:`))).toBe(true);
				}
				expect(events.filter((e) => e.startsWith("separate:")).length).toBeGreaterThan(2);
				expect(res.lrc.startsWith("[00:0")).toBe(true);
				expect(await modelsReady(lang)).toBe(true);
				const avail = await availableLangs();
				expect(avail.find((a) => a.code === lang)?.available).toBe(true);
			}, 600_000);

			test("outDir writes .lrc, .words.json and .vocals.wav; an abort leaves no partial file", async () => {
				const out = await mkdtemp(join(tmpdir(), "align-e2e-"));
				try {
					const sync = new LyricsSync({ lang, saveVocals: true, outDir: out });
					instances.push(sync);
					await sync.load();
					const res = await sync.sync(audio, lyricsPath);
					expect((await readdir(out)).sort()).toEqual([
						"speech.lrc",
						"speech.vocals.wav",
						"speech.words.json",
					]);
					expect(await Bun.file(join(out, "speech.lrc")).text()).toBe(res.lrc);

					const out2 = await mkdtemp(join(tmpdir(), "align-e2e-abort-"));
					const ctrl = new AbortController();
					const sync2 = new LyricsSync({
						lang,
						outDir: out2,
						onProgress: (stage, done) => {
							if (stage === "separate" && done === 1) ctrl.abort();
						},
					});
					instances.push(sync2);
					await sync2.load();
					let caught: unknown;
					try {
						await sync2.sync(audio, lyricsPath, { signal: ctrl.signal });
					} catch (e) {
						caught = e;
					}
					expect(caught).toBeInstanceOf(AbortError);
					expect((caught as Error).name).toBe("AbortError");
					expect(await readdir(out2)).toEqual([]);
					await rm(out2, { recursive: true, force: true });
				} finally {
					await rm(out, { recursive: true, force: true });
				}
			}, 600_000);

			test("separate: false skips Demucs, never loads it and still aligns the speech fixture", async () => {
				const lyrics = await Bun.file(lyricsPath).text();
				const stages = new Set<string>();
				// A bogus Demucs path proves that the weights are never touched on this path.
				const sync = new LyricsSync({
					lang,
					separate: false,
					demucsModelPath: "/nonexistent/htdemucs.onnx",
					onProgress: (stage) => stages.add(stage),
				});
				instances.push(sync);
				await sync.load();
				const res = await sync.sync(audio, lyricsPath);
				expect(stages.has("separate")).toBe(false);
				expect(stages.has("emit")).toBe(true);
				expect(res.words.length).toBe(lyrics.split(/\s+/).filter((w) => w !== "").length);
				const mean = res.words.reduce((a, w) => a + w.score, 0) / res.words.length;
				console.log(`[e2e ${lang}] separate:false mean score=${mean.toFixed(3)}`);
				expect(mean).toBeGreaterThan(0.3);
				// The per-call override wins over the constructor: this call needs Demucs and must fail on the bogus path.
				await expect(sync.sync(audio, lyricsPath, { separate: true })).rejects.toThrow();
			}, 600_000);

			test("lyrics that do not fit the audio raise AlignError, not a crash", async () => {
				const sync = new LyricsSync({ lang });
				instances.push(sync);
				await sync.load();
				const [l, r] = await decodeToF32(audio, { sampleRate: ORIGINAL_SR, channels: 2 });
				// 0.5 s of audio cannot hold 200 characters.
				const short: [Float32Array, Float32Array] = [
					(l as Float32Array).subarray(0, ORIGINAL_SR / 2),
					(r as Float32Array).subarray(0, ORIGINAL_SR / 2),
				];
				const lyrics = Array.from({ length: 40 }, () => "lalala").join(" ");
				await expect(sync.syncFromBuffers(short, lyrics)).rejects.toBeInstanceOf(AlignError);
			}, 600_000);
		});
	}
});
