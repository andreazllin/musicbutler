# @musicbutler/align

Word-level lyrics alignment for Bun: one song plus its plain-text lyrics in,
an enhanced `.lrc` (`[mm:ss.xx]` lines, `<mm:ss.xx>` words) out. It is a
TypeScript port of [mikezzb/lyrics-sync](https://github.com/mikezzb/lyrics-sync)
that runs on CPU with no Python. The design lives in
`docs/lyrics-sync-functionality-implementation-plan.md`.

Pipeline: ffmpeg decode → HTDemucs vocals (onnxruntime-node, 7.8 s chunks,
25 % linear overlap-add) → mono 16 kHz → wav2vec2 CTC log-probabilities
(Transformers.js, 15 s windows) → CTC forced alignment (trellis + backtrack)
→ words → LRC.

## Install

```sh
brew install ffmpeg          # any ffmpeg >= 5 on PATH
bun install                  # from the repository root; onnxruntime-node is a trusted dependency
bun run packages/align/src/cli.ts models pull          # optional: pre-download the weights
```

Models are cached in `~/.cache/musicbutler` (override with `MUSICBUTLER_CACHE`).
`scripts/fetch-models.ts` at the repository root does the same for a Docker build.

| Model | File | Size | Licence |
| --- | --- | --- | --- |
| HTDemucs (StemSplitio/htdemucs-onnx) | `htdemucs_fp16weights.onnx` | 166 MB | MIT |
| en-US: wav2vec2-large-960h-lv60-self, `q8` (`linandrea/wav2vec2-large-960h-lv60-self-onnx`, export of `facebook/wav2vec2-large-960h-lv60-self`) | `onnx/model_quantized.onnx` + 5 JSON files | 339 MB | Apache-2.0 |
| en-US, `fp32` | `onnx/model.onnx` | 1.26 GB | Apache-2.0 |
| it-IT: wav2vec2-large-xlsr-53-italian, `q8` (`linandrea/wav2vec2-large-xlsr-53-italian-onnx`, export of `jonatasgrosman/wav2vec2-large-xlsr-53-italian`) | `onnx/model_quantized.onnx` + 5 JSON files | 355 MB | Apache-2.0 |
| it-IT, `fp32` | `onnx/model.onnx` | 1.26 GB | Apache-2.0 |

`MUSICBUTLER_ASR_EN` and `MUSICBUTLER_ASR_IT` override the model id, or point at
the absolute path of an export directory. An empty value disables the language.

## Usage

CLI:

```sh
bun run packages/align/src/cli.ts sync song.mp3 lyrics.txt --out ./output [--lang en-US] [--dtype q8|fp32] [--save-vocals] [--json] [--lrc-spacing original] [--threads N] [--no-separate]
bun run packages/align/src/cli.ts separate song.mp3 --out vocals.wav
bun run packages/align/src/cli.ts models pull [--lang en-US,it-IT]
```

`sync` writes `<name>.lrc` and `<name>.words.json` (and `<name>.vocals.wav` with
`--save-vocals`), prints the LRC to stdout and the stage timings to stderr. On an
alignment failure it exits with code 2 and a one-line hint.

Library:

```ts
import { LyricsSync } from "@musicbutler/align";

const engine = new LyricsSync({ lang: "en-US", onProgress: (stage, done, total) => {} });
await engine.load();                                  // once; holds both models in memory
const { words, lrc, lines } = await engine.syncText("song.mp3", lyricsText, { signal });
```

Load one `LyricsSync` per process and reuse it: `load()` costs 1–2 s from the
cache and keeps about 260 MB of weights resident. `sync`, `syncText` and
`syncFromBuffers` accept an `AbortSignal`; an abort throws `AbortError` and
writes no partial file. `onProgress` fires at every stage boundary and once per
Demucs chunk and per ASR window (stages `decode | separate | emit | align | write`).
`ensureModels(lang)`, `modelsReady(lang)` and `availableLangs()` let a server
pre-fetch and report model availability without a network request.

`separate: false` (constructor option, per-call option, or `--no-separate`) skips
Demucs: the mix is downmixed to mono, resampled and fed straight to wav2vec2. Use
it for an acapella or an already isolated vocal track; on a full mix it lowers
the alignment quality. Both models load lazily, so this path works without the
Demucs weights.

## Performance (Apple M-series, CPU)

Demucs dominates: about 1.3 s per 7.8 s chunk, so about 55 s for a 4-minute
song. The large wav2vec2 models at `q8` need about 1.0–1.2 s per 15 s window
(measured on the 17 s speech fixtures: en 1.22 s, it 1.11 s in total). The trellis is
`O(T·N)` in float32: about 72 MB for a 4-minute song with 1 500 characters.

## Limitations

- Two languages, `en-US` and `it-IT`. Adding a third means one `LANGS` entry
  plus an ONNX export (see "Exporting an ASR model").
- Digits and punctuation-only words cannot be aligned (neither vocabulary holds a
  digit). They inherit the timestamp of the previous word. Write `three`, not `3`.
- Lyrics must match the audio. Extra verses, a wrong language or an instrumental
  track give an `AlignError` or plausible but wrong timings. Try `--dtype fp32`
  for a borderline case.
- Alignment is monotonic: it cannot handle repeated choruses that the lyrics list
  once.
- The `fixtures/say` test audio is synthesized speech with a quiet music bed,
  not singing. It validates the plumbing and the aligner, not singing accuracy.
  Generate it with `bun run packages/align/scripts/make-fixture.ts` (macOS only);
  only the `lyrics.txt` files are committed.

## Exporting an ASR model

Transformers.js loads ONNX graphs, and Hugging Face holds no ONNX export of the
two chosen models, so they were exported once with
`scripts/export-asr-onnx.py`. The script runs `optimum-cli export onnx`, folds
constants and quantizes the weights to uint8 (`onnx/model_quantized.onnx`, the
`q8` dtype), keeps the fp32 graph (`onnx/model.onnx`), and generates the
`tokenizer.json` that the JS tokenizer needs from `vocab.json`:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install "optimum[exporters,onnxruntime]" torch transformers onnx onnxruntime
python3 packages/align/scripts/export-asr-onnx.py facebook/wav2vec2-large-960h-lv60-self out/wav2vec2-large-960h-lv60-self-onnx
python3 packages/align/scripts/export-asr-onnx.py jonatasgrosman/wav2vec2-large-xlsr-53-italian out/wav2vec2-large-xlsr-53-italian-onnx
hf upload linandrea/wav2vec2-large-960h-lv60-self-onnx out/wav2vec2-large-960h-lv60-self-onnx .
hf upload linandrea/wav2vec2-large-xlsr-53-italian-onnx out/wav2vec2-large-xlsr-53-italian-onnx .
```

Checks made on 2026-09-10 for both exports (`MUSICBUTLER_E2E=1 bun test
packages/align/test/e2e.test.ts`): `<pad>` is the blank at id 0 and `|` the
word delimiter at id 4 in both vocabularies; frames arrive at 20 ms with
strictly increasing times; the greedy decode of each speech fixture reads as
the source text; mean word score 0.93 (en) and 0.86 (it). The Italian
vocabulary is lower case and holds `à á è é ì í ò ó ù ú š`, so the normalizer
keeps the accents and lower-cases the words (§5.7 fallback map stays unused).

To test an export before publishing it, point the engine at the directory:
`MUSICBUTLER_ASR_IT=/abs/path/to/out/wav2vec2-large-xlsr-53-italian-onnx`, or
place it under `~/.cache/musicbutler/transformers/<model id>/`.
