/**
 * Renders `fixtures/say/<lang>/lyrics.txt` to `speech.wav` (stereo 44.1 kHz)
 * with the macOS `say` command plus a quiet music bed at about -20 dB, so
 * that Demucs has something to separate (§6 M5).
 *
 *   bun run packages/align/scripts/make-fixture.ts [en|it|all]
 *
 * The fixture is speech, not singing (§7.10). `.wav`/`.aiff` are gitignored;
 * only `lyrics.txt` is committed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ffmpegPath } from "../src/audio/ffmpeg.ts";

const ROOT = join(import.meta.dir, "..", "fixtures", "say");

interface Voice {
	preferred: string;
	locale: string;
	/** Bed: a slow sine sweep (en) or band-limited noise (it). */
	bed: string;
}

const VOICES: Record<string, Voice> = {
	en: { preferred: "Samantha", locale: "en_US", bed: "sine=frequency=110:beep_factor=0" },
	it: { preferred: "Alice", locale: "it_IT", bed: "anoisesrc=color=brown:seed=7" },
};

async function run(cmd: string[]): Promise<void> {
	const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "pipe" });
	const err = await new Response(proc.stderr).text();
	if ((await proc.exited) !== 0) throw new Error(`${cmd[0]} failed: ${err.trim()}`);
}

/** Picks the preferred voice, else any voice of that locale (§6 M5). */
async function pickVoice(v: Voice): Promise<string> {
	const proc = Bun.spawn(["say", "-v", "?"], { stdout: "pipe", stderr: "ignore" });
	const list = await new Response(proc.stdout).text();
	await proc.exited;
	const lines = list.split("\n");
	if (lines.some((l) => l.startsWith(`${v.preferred} `) && l.includes(v.locale)))
		return v.preferred;
	const any = lines.find((l) => l.includes(v.locale));
	if (!any) throw new Error(`no ${v.locale} voice installed; run: say -v '?'`);
	return (any.split(/\s{2,}/)[0] as string).trim();
}

async function make(lang: string): Promise<void> {
	const v = VOICES[lang];
	if (!v) throw new Error(`unknown language ${lang}; use en or it`);
	const dir = join(ROOT, lang);
	const lyrics = join(dir, "lyrics.txt");
	if (!existsSync(lyrics)) throw new Error(`missing ${lyrics}`);
	const aiff = join(dir, "speech.aiff");
	const wav = join(dir, "speech.wav");
	const voice = await pickVoice(v);
	console.log(`[${lang}] say -v ${voice} -> ${aiff}`);
	// The engine doc says LEF32, but AIFF is big-endian and `say` rejects LEF32 ("fmt?"); BEF32 is the equivalent.
	await run(["say", "-v", voice, "-o", aiff, "--data-format=BEF32@44100", "-f", lyrics]);
	console.log(`[${lang}] mixing bed (${v.bed}) at -20 dB -> ${wav}`);
	// Speech is duplicated to stereo; the bed is generated for the same duration and
	// mixed at -20 dB relative to full scale (speech from `say` peaks near -3 dB).
	await run([
		ffmpegPath(),
		"-v",
		"error",
		"-y",
		"-i",
		aiff,
		"-f",
		"lavfi",
		"-i",
		`${v.bed}:sample_rate=44100`,
		"-filter_complex",
		"[1:a]volume=-20dB,aformat=channel_layouts=stereo[bed];[0:a]aformat=channel_layouts=stereo[sp];[sp][bed]amix=inputs=2:duration=first:normalize=0[out]",
		"-map",
		"[out]",
		"-ac",
		"2",
		"-ar",
		"44100",
		"-c:a",
		"pcm_s16le",
		wav,
	]);
	console.log(`[${lang}] wrote ${wav}`);
}

const which = process.argv[2] ?? "all";
for (const lang of which === "all" ? Object.keys(VOICES) : [which]) await make(lang);
