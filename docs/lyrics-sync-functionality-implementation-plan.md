# musicbutler: the Lyrics Sync Engine

**Goal:** Re-implement [mikezzb/lyrics-sync](https://github.com/mikezzb/lyrics-sync)
(Python, PyTorch) as a TypeScript library and CLI that runs on **Bun**. The
output is word level time aligned lyrics. The format is `.lrc` with
`<mm:ss.xx>` word tags. The inputs are one polyphonic song and its plain text
lyrics.

**Where the code lives:** `packages/align` inside the musicbutler repository.
The engine is one workspace package. It is not a separate project. See
`docs/PLAN.md` §13.1.

**Author of this plan:** Claude, 2026-09-09. Every fact in §0 was verified on
this machine (macOS arm64, Bun 1.3.14). Treat §0 as ground truth. Treat the rest
of the document as the design to build.

**Relation to the rest of musicbutler:** `docs/PLAN.md` is the plan for the
whole application. It cites this document as the authority on the alignment
engine. The two documents disagree on some points. `docs/PLAN.md` §13 lists the
differences. Resolve them before you write alignment code.

---

## 0. Verified facts (do not derive these again)

| Fact | Value |
| --- | --- |
| Bun version | 1.3.14 at `~/.bun/bin/bun` |
| `@huggingface/transformers` | 4.2.0 works under Bun. `Wav2Vec2ForCTC.from_pretrained("Xenova/wav2vec2-base-960h", { dtype: "q8", device: "cpu" })` returns logits. 3 s of 16 kHz audio gives logits dims `[1, 149, 32]` in 0.16 s. A cold model load takes about 19 s, because it downloads. Later loads are fast |
| `AutoProcessor` for wav2vec2 | Returns a **feature extractor only**. It has no `.tokenizer`. Load the tokenizer separately with `AutoTokenizer.from_pretrained(id)` |
| Tokenizer behavior | `tok("HELLO\|WORLD", { add_special_tokens: false }).input_ids` gives `[11,5,15,15,8,4,18,8,13,15,14]` as a BigInt64Array. The tokenizer returns one id per character |
| Wav2Vec2 vocabulary (32 ids) | `<pad>`=0 (**the CTC blank**), `<s>`=1, `</s>`=2, `<unk>`=3, `\|`=4 (the word delimiter), E=5, T=6, A=7, O=8, N=9, I=10, H=11, S=12, R=13, D=14, L=15, U=16, M=17, W=18, C=19, F=20, G=21, Y=22, P=23, B=24, V=25, K=26, `'`=27, X=28, J=29, Q=30, Z=31. The vocabulary holds upper case letters only |
| Frame duration | `config.inputs_to_logits_ratio` is **undefined** in the JS config. Hard code **320 samples / 16000 Hz = 0.020 s per frame**. The observed 149 frames for 48 000 samples confirms this value, because `floor((48000-400)/320)+1 = 149` |
| `onnxruntime-node` | 1.24.3 works under Bun on macOS arm64. The reported breakages affect Windows only. You must trust the postinstall script. Run `bun pm trust --all` after `bun add` |
| Demucs model | `StemSplitio/htdemucs-onnx`, file `htdemucs_fp16weights.onnx`, 158 MB, MIT license. URL: `https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx`. The fp32 variant `htdemucs.onnx` is 316 MB |
| Demucs input and output | Input `mix`: float32 `[1, 2, 343980]`, stereo, 44 100 Hz, 7.8 s, range −1 to 1. Output `stems`: float32 `[1, 4, 2, 343980]`. The stem order is `[drums, bass, other, vocals]`, so **vocals = index 3**. The graph performs STFT, iSTFT, and normalization **inside** itself |
| Demucs speed | About 1.3 s for each 7.8 s chunk on CPU (M-series). Session creation takes 1.3 s. A 4-minute song needs about 41 chunks, so about 55 s |
| Probe scripts | `/tmp/lsync-probe/{probe,tok-probe,demucs-probe}.ts`. A cleanup may have removed them |

Two limits apply to the table above. The vocabulary, the blank id, and the word
delimiter id hold for `Xenova/wav2vec2-base-960h` only. Another CTC model orders
its vocabulary differently. Read those three values from the tokenizer at load
time. See §5.6 and §7.15.

The frame stride is not model specific. Every wav2vec2 variant uses the same
convolutional frontend, so the stride stays at 320 samples and the receptive
field stays at 400 samples. `ASR_FRAME_SEC` therefore stays 0.02 for the Italian
model too.

---

## 1. What the original does (reference behavior)

The pipeline lives in `lsync/__init__.py::LyricsSync.sync`. It runs these steps:

1. **VoiceExtractor.** Load the audio as stereo 44.1 kHz. Normalize it by mean
   and standard deviation. Run `htdemucs` with split enabled, overlap 0.25, and
   shifts 1. Take the vocals stem. Keep the **left channel only**. Resample to
   16 kHz with librosa.
2. **PhonemeRecognizer.** Split the 16 kHz vocals into non-overlapping **15 s
   windows** with `librosa.util.frame`. That function **drops the trailing
   partial window**, which is a bug that this port fixes. Run `Wav2Vec2ForCTC`
   for each window. Concatenate the logits along time. Apply `log_softmax` to
   get an emission of shape `[T, 32]`.
3. **LyricsProcessor.process** for en-US. Upper case the text. Replace `' '` and
   `'\n'` with `|`. Replace `_` with `'`. Replace `’` with `'`. Tokenize the
   whole string to one id per character.
4. **Aligner.** Run CTC forced alignment. The trellis has shape `[T+1, N+1]`.
   The dynamic program uses the standard two moves: stay on the blank, or
   advance to the next token. Take the argmax of the last column to find the end
   frame. Backtrack to a path of `(token_index, time_index, prob)`.
5. **get_words_from_path.** Collapse runs of equal token indices into character
   segments `[start_frame, end_frame)`. Merge the characters between two `|`
   delimiters into a `Word(label, start_s, end_s)`.
6. **LrcFormatter.words2lrc.** Walk the *original* lyrics line by line. Start
   each line with `[mm:ss.xx]`, where the time is the end of the previous word.
   The first line uses `[00:00.00]`. Write each word as `<mm:ss.xx> word` with
   the original spelling. The formatter assumes that the count of aligned words
   equals the count of whitespace separated words.
7. Save `output/vocals/{name}.wav`, `output/words/{name}.csv`, and
   `output/lrc/{name}.lrc`.

The original has these weaknesses. Fix each one, and name it in a code comment:

- The trailing audio under 15 s gets no emissions, because of the dropped frame.
- Frame timing drifts by 20 ms for each window, because 240 000 samples produce
  749 frames, not 750.
- Punctuation and digits become `<unk>` tokens with id 3. The acoustic model
  almost never emits that token, so alignment degrades or fails. A failure
  raises the "Failed" exception in the backtrack step.
- A word that holds only punctuation breaks the `words[counter]` indexing in the
  formatter.
- The pipeline uses the left vocal channel only.

---

## 2. Goals and non-goals

**Goals**

- `bun run cli sync <audio> <lyrics.txt> [--out dir]` writes `.lrc`,
  `words.json`, and an optional `vocals.wav`.
- The library is importable:
  `const { words, lrc } = await new LyricsSync().sync(audioPath, lyricsPath)`.
- English (`en-US`) matches or beats the Python version. The output is
  deterministic, because the port uses no random shifts.
- Italian (`it-IT`) works through the same pipeline. Only the ASR model and the
  word normalizer change. §5.7 defines the language seam. §6 M7 gates the
  Italian model, because no ONNX export is verified yet.
- CPU only. No Python and no PyTorch at runtime. The only native dependency is
  `onnxruntime-node`, which Transformers.js pulls in anyway, plus a system
  `ffmpeg`.
- The pure TypeScript core has unit tests. That core covers the aligner, the
  merger, the LRC writer, and the overlap-add step.

**Non-goals for v1**

- Training and fine-tuning. GPU support. A browser build.
- Any language other than `en-US` and `it-IT`. Keep the language seam open so
  that someone can add a third language later. Do not build one.
- Number expansion. Neither model vocabulary holds a digit, so a numeric word
  becomes unalignable and inherits the timestamp of the previous word. Write
  `tre` instead of `3` in the lyrics file to align that word.

---

## 3. Architecture

```
audio file ─ffmpeg→ Float32 stereo 44.1k ─→ Demucs (onnxruntime-node, chunked overlap-add)
   → vocals stereo 44.1k ─downmix→ mono ─ffmpeg/resampler→ mono 16k
   → Wav2Vec2ForCTC (transformers.js, windowed) → log-softmax emission [T,32] + frame times
lyrics.txt ─→ per-language normalize per word → char tokens (1:1 with chars) + word map
emission + tokens ─→ CTC forced alignment (trellis + backtrack) → char path
path + word map + frame times ─→ Word[] {text, start, end, score}
Word[] + original lyrics ─→ LRC string
```

These dependency decisions are settled:

- **Audio decode and resample.** Call `ffmpeg` through `Bun.spawn` and read raw
  `f32le` from stdout. This is the simplest and fastest option, and it handles
  every format. Report a clear error when `ffmpeg` is absent, and check with
  `which ffmpeg`. A later option is a pure JS fallback:
  `@alexanderolsen/libsamplerate-js` for resampling, and `mpg123-decoder` or
  `@wasm-audio-decoders/flac` for decoding.
- **Demucs.** Call `onnxruntime-node` directly. Do not go through
  Transformers.js, which has no Demucs architecture.
- **Wav2Vec2.** Use `@huggingface/transformers` with `Wav2Vec2ForCTC`,
  `AutoProcessor`, and `AutoTokenizer`. The default `dtype` is `"q8"`. A
  `"fp32"` flag enables accuracy comparisons. The model id depends on the
  language. See §5.7.
- **Everything else.** Write TypeScript by hand with typed arrays. Add no
  numeric library.

---

## 4. Repository layout

```
packages/align/
├── package.json            # "type": "module", bin: musicbutler
├── tsconfig.json           # strict, moduleResolution bundler, types: ["bun-types"]
├── bunfig.toml             # [install] trustedDependencies = ["onnxruntime-node"]
├── README.md
├── src/
│   ├── index.ts            # public API: LyricsSync, types
│   ├── cli.ts              # bun CLI (sync | separate | emit | align sub-commands)
│   ├── config.ts           # constants: sample rates, window sizes, model ids/urls, cache dir
│   ├── types.ts            # Word, CharSegment, PathPoint, Emission, AlignOptions ...
│   ├── audio/
│   │   ├── ffmpeg.ts       # decodeToF32(path, {sr, channels}) ; resampleF32(mono, from, to)
│   │   ├── wav.ts          # writeWav16(path, channels: Float32Array[], sr)
│   │   └── ops.ts          # deinterleave, downmixToMono, padTo, clamp
│   ├── separation/
│   │   ├── demucs.ts       # DemucsSeparator: load(), separate(stereo): Promise<{vocals: [L,R]}>
│   │   └── chunking.ts     # makeWindow(), planChunks(), overlapAdd()  (pure, tested)
│   ├── asr/
│   │   ├── wav2vec2.ts     # Wav2Vec2Emitter: load(), emit(mono16k): Promise<Emission>
│   │   └── logsoftmax.ts   # logSoftmaxRows(Float32Array, rows, cols)
│   ├── text/
│   │   ├── vocab.ts        # Vocab built from the tokenizer: charToId, blankId, wordDelimId, unkId
│   │   ├── langs.ts        # LANGS registry: model id + normalizer + fallback char map per language
│   │   ├── normalize.ts    # normalizeWordEn(), normalizeWordIt() (see §5.7)
│   │   └── tokenize.ts     # tokenizeLyrics(text, lang, vocab): { tokens: Int32Array, charToWord: Int32Array, words: SourceWord[] }
│   ├── align/
│   │   ├── trellis.ts      # buildTrellis(emission, tokens, blankId): Trellis
│   │   ├── backtrack.ts    # backtrack(trellis, emission, tokens, blankId): PathPoint[]
│   │   ├── segments.ts     # pathToCharSegments(path), segmentsToWords(segments, charToWord, frameTime)
│   │   └── index.ts        # forcedAlign(emission, tokens, opts)
│   ├── lrc/
│   │   └── format.ts       # secondsToLrc(), wordsToLrc(words, sourceWords, lines)
│   └── models/
│       └── download.ts     # ensureFile(url, destPath, {expectedBytes?}) with resume + progress
├── test/
│   ├── chunking.test.ts
│   ├── logsoftmax.test.ts
│   ├── tokenize.test.ts
│   ├── normalize-it.test.ts
│   ├── trellis.test.ts
│   ├── segments.test.ts
│   ├── lrc.test.ts
│   └── e2e.test.ts         # gated behind MUSICBUTLER_E2E=1 (downloads models, uses `say`)
├── fixtures/
│   └── say/                # generated by scripts/make-fixture.ts (macOS `say`)
└── scripts/
    ├── make-fixture.ts     # renders a lyric text with `say` to 44.1k stereo WAV
    └── eval-jamendo.ts     # optional: runs on f90/jamendolyrics and reports AAE / PCS
```

---

## 5. Module specifications

### 5.1 `config.ts`

```ts
export const ORIGINAL_SR = 44100;
export const TARGET_SR = 16000;
export const DEMUCS_SEGMENT_SAMPLES = 343_980;         // 7.8 s @ 44.1k, fixed by the ONNX graph
export const DEMUCS_OVERLAP = DEMUCS_SEGMENT_SAMPLES >> 2; // 25 %, as in the reference infer.py
export const DEMUCS_VOCALS_INDEX = 3;
export const ASR_WINDOW_SEC = 15;                      // 240 000 samples @ 16k
export const ASR_FRAME_SAMPLES = 320;                  // Wav2Vec2 total stride
export const ASR_FRAME_SEC = ASR_FRAME_SAMPLES / TARGET_SR; // 0.02
export const MODELS = {
  demucs: { url: "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx", file: "htdemucs_fp16weights.onnx", bytes: 158_000_000 /* approx; verify with HEAD */ },
  asr: {
    "en-US": "Xenova/wav2vec2-base-960h",   // verified, see §0
    "it-IT": process.env.MUSICBUTLER_ASR_IT ?? "",  // set by M7; empty means "not installed yet"
  } as const,
};
export type Lang = keyof typeof MODELS.asr;   // "en-US" | "it-IT"
export const DEFAULT_LANG: Lang = "en-US";
export const CACHE_DIR = process.env.MUSICBUTLER_CACHE ?? `${process.env.HOME}/.cache/musicbutler`;
```

Point the Transformers.js cache at the same root:
`env.cacheDir = join(CACHE_DIR, "transformers")`.

### 5.2 `audio/ffmpeg.ts`

```ts
export async function decodeToF32(path: string, opts: { sampleRate: number; channels: 1 | 2 }): Promise<Float32Array[]>
// spawn: ffmpeg -v error -i <path> -f f32le -acodec pcm_f32le -ac <ch> -ar <sr> pipe:1
// read stdout fully (Bun: `await new Response(proc.stdout).arrayBuffer()`), check exit code,
// wrap as Float32Array (byteLength must divide by 4*ch), deinterleave into per-channel arrays.

export async function resampleMono(x: Float32Array, from: number, to: number): Promise<Float32Array>
// spawn: ffmpeg -v error -f f32le -ar <from> -ac 1 -i pipe:0 -f f32le -ar <to> -ac 1 pipe:1
// write x to stdin, read stdout. Use `-af aresample=resampler=soxr` if available, else default swr.
```

If `Bun.which("ffmpeg")` returns null, throw a helpful error:
`Error("ffmpeg not found on PATH. Install it with: brew install ffmpeg")`.

### 5.3 `separation/chunking.ts` (pure, unit tested)

This module ports `infer.py`.

```ts
export function makeWindow(n: number, overlap: number): Float32Array // ones, linear fade-in/out of length `overlap`
export function planChunks(total: number, n = DEMUCS_SEGMENT_SAMPLES, overlap = DEMUCS_OVERLAP): { start: number; end: number }[]
// stride = n - overlap; nChunks = max(1, ceil(total / stride)); end = min(start + n, total)
export class OverlapAdd { constructor(channels: number, total: number, window: Float32Array); add(start, end, chunkOut: Float32Array[]): void; finish(): Float32Array[] } // divides by max(weight, 1e-8)
```

Tests: feed chunks of a constant signal through `OverlapAdd`. The result must
hold that constant everywhere, within 1e-6. `planChunks` must cover `[0,total)`
with no gaps. The caller pads the last chunk.

### 5.4 `separation/demucs.ts`

```ts
export class DemucsSeparator {
  static async load(opts?: { modelPath?: string; threads?: number }): Promise<DemucsSeparator>
  // ensureFile(MODELS.demucs) → ort.InferenceSession.create(path, { executionProviders: ["cpu"], graphOptimizationLevel: "all", intraOpNumThreads })
  async separateVocals(stereo: [Float32Array, Float32Array], onProgress?: (done, total) => void): Promise<[Float32Array, Float32Array]>
  // for each chunk: build [1,2,N] channel-major buffer (L then R), zero-pad the tail;
  // run({ mix }) → stems.data as Float32Array, layout [4][2][N]; vocals L at offset (3*2+0)*N, R at (3*2+1)*N;
  // OverlapAdd.add(start, end, [L.slice(0,clen), R.slice(0,clen)])
}
```

Do **not** apply the external mean and standard deviation normalization that the
Python version applies. HTDemucs normalizes and de-normalizes inside its own
forward pass, and the ONNX graph includes those steps. For a mono input,
duplicate the channel into both channels. Assert that the input sample rate is
44 100.

### 5.5 `asr/wav2vec2.ts`

```ts
export interface Emission { logProbs: Float32Array; frames: number; classes: number; frameTimes: Float32Array /* seconds, per frame */ }
export class Wav2Vec2Emitter {
  static async load(opts?: { lang?: Lang; modelId?: string; dtype?: "q8" | "fp32" }): Promise<Wav2Vec2Emitter>
  // resolve modelId from MODELS.asr[lang] unless opts.modelId overrides it.
  // Throw a clear error when MODELS.asr[lang] is empty (the Italian model is not installed).
  // AutoProcessor.from_pretrained(id) (feature extractor), Wav2Vec2ForCTC.from_pretrained(id, { dtype, device: "cpu" }), AutoTokenizer.from_pretrained(id)
  async emit(mono16k: Float32Array, onProgress?): Promise<Emission>
  // windows = split into ASR_WINDOW_SEC*TARGET_SR sample windows, INCLUDING the final partial window
  //   (skip it only when shorter than ASR_FRAME_SAMPLES*2). For each: processor(window) → model(inputs) → logits [1,F,32];
  //   logSoftmaxRows over each frame; append. frameTimes[f] = windowStartSec + localFrame*ASR_FRAME_SEC
  //   (this removes the 20 ms per window drift of the original).
  get vocab(): Vocab // built from the tokenizer, see §5.6. For en-US, assert it matches the §0 table
}
```

Keep the per window normalization that the feature extractor applies by default.
That matches the Python setting `do_normalize=True`.

### 5.6 `text/tokenize.ts`

One invariant is critical. The module emits **one token for each character of
the normalized string. Every token maps back to a source word index, or to −1
for a delimiter.**

```ts
export interface Vocab { idToChar: string[]; charToId: Map<string, number>; blankId: number; wordDelimId: number; unkId: number }
export function buildVocab(tokenizer: PreTrainedTokenizer): Vocab
// Read the id map from the tokenizer. Read blankId from the pad token.
// Read wordDelimId from the word_delimiter_token, and unkId from the unk token.
// Never hard-code 0 and 4. Only the en-US model is known to use those ids (§0).

export interface SourceWord { text: string; line: number; indexInLine: number }
export interface Tokenized { tokens: Int32Array; charToWord: Int32Array; words: SourceWord[]; lines: string[] }
export function tokenizeLyrics(rawText: string, lang: Lang, vocab: Vocab): Tokenized
```

The algorithm has five steps. Only step 3 differs between languages:

1. Split with `lines = rawText.split(/\r?\n/)`. Keep the original lines for the
   LRC output. Keep blank lines for the output, but produce no words from them.
2. For each line, split with `line.trim().split(/\s+/)` to get the source words.
   Skip the empty results.
3. Apply the normalizer for the language, `LANGS[lang].normalize(w, vocab)`.
   See §5.7. If the result is empty, for example for `"..."` or `"—"`, mark the
   word `alignable=false` and leave it out of the tokens. The formatter then
   gives that word the timestamp of the previous word.
4. Build `tokens`. For each alignable word, map its characters through
   `vocab.charToId`. Put `vocab.wordDelimId` between two words, and not after
   the last word. Fill `charToWord` with the global index of the word, and with
   −1 for a delimiter.
5. Never emit `vocab.unkId`. Never emit the sequence start id or the sequence
   end id.

Tests for en-US: the input `"Hello, world!\n\nIt's ..."` must produce tokens for
`HELLO|WORLD|IT'S`, three alignable words, one unalignable word `"..."`, and a
`charToWord` array of the correct shape.

### 5.7 The language seam: `text/langs.ts` and `text/normalize.ts`

One registry holds everything that depends on the language:

```ts
export interface LangSpec {
  modelId: string;
  normalize(word: string, vocab: Vocab): string;
  /** Applied only when the model vocabulary lacks the character. */
  fallback: Record<string, string>;
}
export const LANGS: Record<Lang, LangSpec>;
```

**Shared rules.** Every normalizer applies NFKC first. Every normalizer replaces
`’` and `‘` with `'`, and replaces `_` with `'`. Every normalizer then upper
cases the word. Every normalizer drops any character that
`vocab.charToId` does not hold. The vocabulary decides the final character set,
not a hard coded regular expression.

**`normalizeWordEn`.** After the shared rules, the surviving set is `[A-Z']`,
which matches the §0 table. Keep the apostrophe. See §7.11.

**`normalizeWordIt`.** After the shared rules, apply the Italian fallback map
before the vocabulary filter:

| Source | Fallback | Reason |
| --- | --- | --- |
| `À Á Â` | `A` | Use only when the vocabulary lacks the accented letter |
| `È É Ê` | `E` | Same |
| `Ì Í Î` | `I` | Same |
| `Ò Ó Ô` | `O` | Same |
| `Ù Ú Û` | `U` | Same |

Apply the fallback for one character only when `vocab.charToId` lacks that
character. Some Italian CTC models hold the accented vowels. Folding them away
in that case loses information and hurts the alignment.

Keep the apostrophe for Italian, and keep it for a stronger reason than in
English. Italian elides articles and prepositions, as in `l'amore`,
`un'altra`, `dell'acqua`, and `c'è`. A speaker pronounces each of those as one
unit, and whitespace splitting already treats each as one word. So the
apostrophe inside the token sequence matches how the model hears the audio. Do
not split on the apostrophe. Do not drop it.

The truncated form `po'` ends with an apostrophe. Keep that trailing apostrophe.
It does not make the word unalignable.

Tests for it-IT (`normalize-it.test.ts`):

1. `"L'amore"` gives `L'AMORE` as one alignable word.
2. `"perché"` gives `PERCHE` when the vocabulary lacks `É`, and `PERCHÉ` when
   the vocabulary holds it. Drive both cases from a fake `Vocab`.
3. `"un po'"` gives two words, and the second is `PO'`.
4. `"città"` gives `CITTA` or `CITTÀ` by the same vocabulary rule.
5. `"3"` gives an empty string, so the word is unalignable.

### 5.8 `align/trellis.ts` and `align/backtrack.ts` (pure, unit tested)

These modules port the PyTorch tutorial algorithm that lyrics-sync uses. They
operate on flat `Float32Array`s.

```ts
export interface Trellis { data: Float32Array; rows: number /* T+1 */; cols: number /* N+1 */ }
export function buildTrellis(em: Emission, tokens: Int32Array, blankId = 0): Trellis
```

```
T = em.frames, N = tokens.length, C = em.classes, E(t,c) = em.logProbs[t*C + c]
trellis[0][0] = 0
trellis[t+1][0] = trellis[t][0] + E(t, blank)                       // cumulative blank
trellis[0][1..N] = -Infinity
for t in 0..T-1:
  for j in 1..N:
    stay   = trellis[t][j]   + E(t, blank)
    change = trellis[t][j-1] + E(t, tokens[j-1])
    trellis[t+1][j] = max(stay, change)
```

Memory use is `(T+1)*(N+1)*4` bytes. A 4-minute song gives T of about 12 000 and
N of about 1 500, so about 72 MB. That is acceptable. If `N > T`, throw
`AlignError("lyrics longer than audio frames")` early.

```ts
export interface PathPoint { tokenIndex: number; timeIndex: number; score: number /* prob in [0,1] */ }
export function backtrack(trellis: Trellis, em: Emission, tokens: Int32Array, blankId = 0): PathPoint[]
```

```
j = N; tStart = argmax_t trellis[t][N] over t in 0..T   (Python uses the whole column)
path = []
for t = tStart down to 1:
  stayed  = trellis[t-1][j]   + E(t-1, blank)
  changed = trellis[t-1][j-1] + E(t-1, tokens[j-1])
  prob    = exp(E(t-1, changed > stayed ? tokens[j-1] : blank))
  path.push({ tokenIndex: j-1, timeIndex: t-1, score: prob })
  if changed > stayed: j -= 1; if j == 0: return path.reverse()
throw AlignError("backtrack failed to reach token 0")
```

Tests: build a synthetic emission of 20 frames by 5 classes, where class k is
loud at frames `[4k, 4k+3]` for the tokens `[1,2,3]`. The first frame of each
token in the path must equal 4·k. Also test a blank dominated tail. Also test
that `N > T` throws.

### 5.9 `align/segments.ts`

```ts
export interface CharSegment { tokenIndex: number; startFrame: number; endFrame: number /* exclusive */; score: number }
export function pathToCharSegments(path: PathPoint[]): CharSegment[] // collapse runs with equal tokenIndex; score = mean
export interface Word { text: string; start: number; end: number; score: number; line: number }
export function segmentsToWords(segs: CharSegment[], tok: Tokenized, frameTimes: Float32Array): Word[]
// group consecutive segments whose charToWord[tokenIndex] is the same non-negative word index;
// start = frameTimes[firstSeg.startFrame]; end = frameTimes[min(lastSeg.endFrame, frames-1)] + ASR_FRAME_SEC;
// text = source word text (original spelling); score = mean of char scores.
// Insert unalignable words with start=end=previous word's end (or 0 if first).
```

The result length must equal `tok.words.length`. Assert that.

### 5.10 `lrc/format.ts`

```ts
export function secondsToLrc(s: number, kind: "line" | "word"): string // "[mm:ss.xx]" | "<mm:ss.xx>", floor hundredths, clamp s>=0
export function wordsToLrc(words: Word[], lines: string[]): string
```

The behavior matches the original, plus the empty line fix:

- Skip blank lines.
- Set the line tag to the start of the **first word on that line**. This
  improves on the original, which used the end of the previous word. Keep the
  original behavior behind `{ lineTagMode: "prev-end" | "first-word" }`. The
  default is `"first-word"`.
- Write each word as ` <mm:ss.xx>word`. The original writes `<tag> word` with a
  space between the tag and the word, and most players accept both forms. The
  default writes no space, which is standard enhanced LRC. An option keeps the
  original spacing.
- Optionally prepend the headers `[ti:]`, `[ar:]`, `[re:musicbutler]`, and
  `[length:]`.

Also export `wordsToJson(words)` for `words.json`. Also export `wordsToCsv` to
match the Python `words/*.csv` output, which uses the columns
`label,start,end`.

### 5.11 `index.ts`

```ts
export interface SyncOptions { lang?: Lang; dtype?: "q8" | "fp32"; saveVocals?: boolean; outDir?: string; onProgress?: (stage: "decode"|"separate"|"emit"|"align"|"write", done: number, total: number) => void }
export class LyricsSync {
  constructor(opts?: SyncOptions)
  async load(): Promise<void>                                      // loads both models (idempotent)
  async sync(audioPath: string, lyricsPath: string): Promise<{ words: Word[]; lrc: string; vocals16k?: Float32Array }>
  async syncFromBuffers(stereo44k: [Float32Array, Float32Array], lyrics: string): Promise<...>
  async separate(audioPath: string): Promise<[Float32Array, Float32Array]>   // exposed for debugging
  async emit(mono16k: Float32Array): Promise<Emission>
}
```

Downmix the vocals to mono by averaging L and R. That beats the left-only
approach of the Python version. Then resample to 16 kHz.

### 5.12 `cli.ts`

Use the built-in `util.parseArgs` from Bun. Add no dependency. Provide these
sub-commands:

- `musicbutler sync <audio> <lyrics.txt> [--lang en-US|it-IT] [--out ./output] [--dtype q8|fp32] [--save-vocals] [--json] [--lrc-spacing original]`
- `musicbutler separate <audio> --out vocals.wav`
- `musicbutler models pull [--lang it-IT]`, which pre-downloads the Demucs model
  and the ASR model for the language
- `musicbutler align --emission em.bin --lyrics ...`, for debugging. This one is
  optional

Print the timing of each stage. On an `AlignError`, exit non-zero with a
one-line message. In that message, suggest `--dtype fp32`. Also suggest a check
that the lyrics match the audio. Also suggest a check that `--lang` matches the
language of the song, because the wrong model produces the same failure.

### 5.13 `models/download.ts`

`ensureFile(url, dest, { expectedBytes })` behaves as follows. If `dest` exists
and the size matches, return. If no expectation exists and `dest` exists,
return. Otherwise stream `fetch(url)` to `dest + ".part"` and report progress
through a callback. Rename the file when the download completes. Send the
`HF_TOKEN` header when that variable is set. These public repositories do not
need it.

---

## 6. Milestones and acceptance criteria

Work in this order. Each milestone must pass before you start the next one.
Commit after each milestone.

**M0: Scaffold (30 minutes or less)**

1. Run `bun init`.
2. Run `bun add @huggingface/transformers onnxruntime-node`.
3. Run `bun add -d bun-types typescript`.
4. Run `bun pm trust --all`.
5. Write `bunfig.toml` with `trustedDependencies`.
6. Set tsconfig to strict.

Accept when `bun run tsc --noEmit` is clean and `bun test` runs. Zero tests is
acceptable here.

**M1: Pure core with tests**

Implement `chunking.ts`, `logsoftmax.ts`, `vocab.ts`, `langs.ts`,
`normalize.ts`, `tokenize.ts`, `trellis.ts`, `backtrack.ts`, `segments.ts`, and
`lrc/format.ts`. Add every unit test from §5, including the Italian
normalizer tests in §5.7. Drive those tests from a fake `Vocab`, so this
milestone needs no model download.

Accept when `bun test` is green, the trellis test reproduces the expected
boundaries, and `wordsToLrc` output for a two-line fixture matches a hand
written expected string exactly.

**M2: Audio input and output**

Implement `ffmpeg.ts`, `wav.ts`, and `ops.ts`. Add a round-trip test:

1. Generate a 1 s sine with `ffmpeg -f lavfi -i "sine=frequency=440:duration=1"`.
2. Decode it.
3. Check that the length is 44 100 by 2. Check that the peak is about 1/√2. A
   check of length and finiteness alone is also acceptable.
4. Resample 44.1k to 16k. The length must fall within ±2 of
   `round(n*16000/44100)`.

Accept when the tests are green and a missing ffmpeg produces a clear error.
Simulate the missing binary with `PATH=/nonexistent`.

**M3: Demucs stage**

Implement `download.ts` and `demucs.ts`. Run a manual check:
`musicbutler separate song.mp3 --out vocals.wav` on any local song. Listen to the
result, or inspect that the RMS of `vocals.wav` is lower than the RMS of the mix
and is not zero.

Accept programmatically when a 20 s clip passes all three checks. The output
length equals the input length. Every sample is finite. The `OverlapAdd` weights
are 1 or more everywhere, which proves that no gaps exist.

**M4: Wav2Vec2 stage**

Implement `wav2vec2.ts`. Accept when `emit()` on a 40 s clip returns `frames` of
about `40/0.02 = 2000`, within ±5. `frameTimes` must increase strictly. Each row
of `logProbs` must sum to 1 in exp space, within 1e-3. Greedy-decode the argmax
for a spoken fixture and print it. The printed text must look like the source
text.

**M5: End to end on a speech fixture (macOS)**

Write `scripts/make-fixture.ts`. It takes a language and a text file with 6 to
10 lines. For English it uses `fixtures/say/en/lyrics.txt` and the voice
`Samantha`:
`say -v Samantha -o fixtures/say/en/speech.aiff --data-format=LEF32@44100 -f lyrics.txt`.
For Italian it uses `fixtures/say/it/lyrics.txt` and an Italian system voice,
`Alice`. Confirm the installed voice first with `say -v '?' | grep it_IT`, and
fall back to any voice that command reports. Write Italian test lines that
contain at least one elision and one accented word, so that the fixture
exercises §5.7.

The script then converts each file with ffmpeg to `speech.wav` in stereo. To
exercise Demucs in a meaningful way, mix in a quiet music bed, for example
`ffmpeg -f lavfi -i "anoisesrc=..."` or a sine sweep at −20 dB.

Write `e2e.test.ts` and gate it behind `MUSICBUTLER_E2E=1`. It runs
`LyricsSync.sync` on the English fixture. Accept when no `AlignError` occurs,
`words.length` equals the word count of the lyrics, the word start times never
decrease, the total word duration fits inside the audio length, and the mean
word score is above 0.3.

Run the same assertions for the Italian fixture in M7, after the Italian model
exists. Write the test so that it loops over the installed languages and skips
a language whose model id is empty.

**M6: CLI and README**

Accept when
`bun run packages/align/src/cli.ts sync packages/align/fixtures/say/en/speech.wav packages/align/fixtures/say/en/lyrics.txt --out /tmp/out`
writes `speech.lrc` and `speech.words.json`, and when `--save-vocals` also
writes `speech.vocals.wav`. The README must document the install steps
(`brew install ffmpeg`, `bun install`), the usage, the model download sizes, and
the limitations.

**M7: The Italian ASR model**

No ONNX export of an Italian wav2vec2 CTC model is verified. This milestone
produces one. Work in this order:

1. Search Hugging Face for an existing ONNX export of an Italian wav2vec2 CTC
   model. Check the `onnx-community` and `Xenova` namespaces first. If one
   exists, skip to step 4.
2. Pick a PyTorch source model. The first candidate is
   `jonatasgrosman/wav2vec2-large-xlsr-53-italian`. The second candidate is
   `dbdmg/wav2vec2-xls-r-300m-italian`. Confirm that the id resolves and that
   the repository holds a CTC head, a `vocab.json`, and a tokenizer config.
   A model without a CTC head cannot align.
3. Export it once with Python, outside this repository:
   `optimum-cli export onnx --model <id> --task automatic-speech-recognition <outdir>`.
   Then quantize to int8 with the Optimum ORT quantizer, to match the `q8`
   default. Publish both variants to Hugging Face under your own account.
   Record the id in `MODELS.asr["it-IT"]`.
4. Load the model with `Wav2Vec2Emitter.load({ lang: "it-IT" })`. Print the
   vocabulary. Confirm that `buildVocab` reads the blank id and the word
   delimiter id correctly, and that neither equals 0 and 4 by accident.
5. Record which accented vowels the vocabulary holds. That answer decides
   whether the §5.7 fallback map runs.

Accept when: the vocabulary check passes, `emit()` on the Italian fixture
returns frames at 20 ms with strictly increasing `frameTimes`, a greedy decode
of the argmax reads as recognizable Italian, and the M5 end to end assertions
pass for the Italian fixture with a mean word score above 0.3.

Note the size cost in the README. An xls-r 300M model or an xlsr-53 large model
is several times larger than `wav2vec2-base-960h`, and it runs slower. See §8.

**M8 (optional): Real song evaluation**

Write `scripts/eval-jamendo.ts`. It clones
`https://github.com/f90/jamendolyrics`, which holds MP3s and
`annotations/words/*.csv` with word start times. Compute the **Average Absolute
Error** and the **Percentage of Correct Segments** at ±0.3 s, exactly as
`lsync/eval.py` does. Report a table. The target is an AAE below 0.5 s on most
tracks with the public 960h model. The fine-tuned model from the paper does
better, and we do not have it.

That dataset covers English. Before you evaluate Italian, check whether it ships
Italian tracks with word level annotations. If it does not, hand annotate the
line start times of three Italian tracks and report the line level error only.
Say in the report which method produced each number.

---

## 7. Pitfalls and gotchas (read before you write code)

1. **`bun pm trust --all` is required.** Without it, Bun skips the postinstall
   script of `onnxruntime-node`. The macOS arm64 binary still ships inside the
   package. State the dependency in `bunfig.toml` anyway, so that CI works.
2. **Transformers.js returns `BigInt64Array` for `input_ids`.** Alignment does
   not use the tokenizer, because `vocab.ts` maps the characters. Use the
   tokenizer once at load to **assert** that `vocab[0]==="<pad>"`, that
   `vocab[4]==="|"`, and that `charToId` agrees with the tokenizer for `A..Z`
   and `'`.
3. **Tensor layout.** ORT tensors are row-major flat arrays. In `stems.data`
   for `[1,4,2,N]`, the element `(0,s,c,i)` sits at `((s*2)+c)*N + i`. In
   Wav2Vec2 logits `[1,F,C]`, the element `(0,f,c)` sits at `f*C + c`. Use
   `Float32Array.subarray` for zero-copy views.
4. **Compute the log-softmax in float32.** Subtract the row maximum first. Call
   `Math.log` and `Math.exp` for each element. That is fast enough for
   12 000 by 32.
5. **`-Infinity` in the trellis is safe.** `Float32Array` stores ±Infinity, and
   `Math.max(-Infinity, x)` works.
6. **The frame count formula** for a window of `n` samples is
   `floor((n - 400) / 320) + 1`. The receptive field of the convolution is 400
   and the stride is 320. Do not assume `n/320`. Always trust the returned
   `logits.dims[1]`.
7. **A very short final ASR window** under 800 samples can make the model
   return 0 or 1 frames. Skip any window shorter than `2*ASR_FRAME_SAMPLES`.
8. **Memory for long songs.** The trellis costs `O(T·N)` in float32. A
   10-minute song with 3 000 tokens needs about 30 000 by 3 000 by 4 bytes, so
   about 360 MB. That is acceptable for v1. If it becomes a problem, process
   each line with anchors. See §9.
9. **ffmpeg stdout buffering.** Read the whole stream with
   `new Response(proc.stdout).arrayBuffer()`. Then check that
   `await proc.exited === 0`. On a failure, read stderr for the message.
10. **The `say` fixture is speech, not singing.** It validates the plumbing and
    the aligner. It does not validate singing accuracy. State that in the test
    file.
11. **Apostrophes.** The vocabulary holds `'` at id 27. Keep the apostrophe
    during normalization. The original depends on it, for example in `IT'S`.
12. **Do not run the Demucs `shifts` option.** That option averages random time
    shifts. The original used `shifts=1`, which is one random shift. This port
    needs determinism.
13. **Transformers.js download progress.** Pass `progress_callback` to
    `from_pretrained` to drive CLI progress. Set the cache directory with
    `env.cacheDir`.
14. **Bun and ORT threads.** The default `intraOpNumThreads` is fine. Expose a
    `--threads` flag for tuning.
15. **Never hard code the blank id or the delimiter id.** `<pad>`=0 and `|`=4
    hold for `Xenova/wav2vec2-base-960h` only, as §0 states. Another model
    orders its vocabulary differently. A wrong blank id does not throw. It
    produces plausible timings that are wrong, which is the worst failure mode
    in this pipeline. Read both ids from the tokenizer in `buildVocab`.
16. **Italian accented vowels depend on the model.** Check the vocabulary
    before you fold `È` to `E`. If the vocabulary holds the accented letter, the
    fold throws away information that the acoustic model uses. §5.7 defines the
    rule.

---

## 8. Performance expectations (CPU, M-series)

| Stage | 4-minute song |
| --- | --- |
| ffmpeg decode | Under 1 s |
| Demucs (41 chunks by 1.3 s) | About 55 s |
| Resample | Under 1 s |
| Wav2Vec2 q8 (16 windows by about 0.8 s) | About 13 s |
| Trellis and backtrack (12 000 by 1 500) | Under 1 s in plain JS loops |
| **Total** | **About 70 s** |

The Wav2Vec2 row assumes the English `wav2vec2-base-960h` model at `q8`. An
Italian xlsr-53 large model or an xls-r 300M model holds several times more
parameters. Expect that row to grow by a factor of 3 to 5, so budget 40 s to
70 s for a 4-minute song. Measure the real number in M7 and update this table.

If Demucs dominates the runtime, two later options exist. Try the CoreML
execution provider with `executionProviders: ["coreml", "cpu"]`, and test it,
because it may fall back for unsupported operators. Or offer `--no-separate`
for input that already holds isolated vocals or an acapella.

---

## 9. Stretch goals (after v1 is green)

- **Line anchored alignment.** Run the alignment for each lyric line inside a
  window that a coarse pass finds. This bounds the memory use. It also makes a
  long track less likely to fail.
- **A third language.** Add one entry to `LANGS` (§5.7) and one entry to
  `MODELS.asr`. Follow the M7 steps to get an ONNX export. A language without
  alphabetic word boundaries needs more work. For such a language, treat each
  character as one word and emit no delimiter tokens. The original project does
  this in `__process_cn`, and its per-character `Word` path is worth reading
  before you start.
- **`<unk>` tolerance.** Allow optional-skip tokens for punctuation-only words
  instead of dropping those words.
- **Confidence based warnings.** Flag any word with `score < 0.1` in the CLI
  output. Users can then spot lyrics that do not match the audio.
- **Web build.** `onnxruntime-web` and Transformers.js already target the
  browser, and the pure core is runtime agnostic. Only `ffmpeg.ts` needs a
  WebCodecs or WASM replacement.
- **Fine-tuned singing model.** Fine-tune `facebook/wav2vec2-base` on DALI, as
  the original `train.ipynb` does. Export it to ONNX. Load it with
  `Wav2Vec2ForCTC.from_pretrained(localPath)`.

---

## Appendix A: Commands

```bash
# bootstrap (from the musicbutler repo root)
mkdir -p packages/align && cd packages/align
bun init -y
cd ../.. && bun add --cwd packages/align @huggingface/transformers onnxruntime-node
bun add -d typescript bun-types
bun pm trust --all          # also declare trustedDependencies in the root bunfig.toml
brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg

# dev loop
bun test
bun run tsc --noEmit
bun run packages/align/src/cli.ts models pull
bun run packages/align/src/cli.ts sync path/to/song.mp3 path/to/lyrics.txt --out ./output --save-vocals
MUSICBUTLER_E2E=1 bun test packages/align/test/e2e.test.ts

# fixture (macOS)
bun run packages/align/scripts/make-fixture.ts
```

## Appendix B: Minimal working snippets (verified)

```ts
// Wav2Vec2 emission
import { AutoProcessor, AutoTokenizer, Wav2Vec2ForCTC } from "@huggingface/transformers";
const id = "Xenova/wav2vec2-base-960h";
const processor = await AutoProcessor.from_pretrained(id);
const tokenizer = await AutoTokenizer.from_pretrained(id);
const model = await Wav2Vec2ForCTC.from_pretrained(id, { dtype: "q8", device: "cpu" });
const inputs = await processor(mono16k /* Float32Array */);
const { logits } = await model(inputs);          // logits.dims = [1, F, 32], logits.data: Float32Array
```

```ts
// Demucs chunk
import * as ort from "onnxruntime-node";
const sess = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
const mix = new Float32Array(2 * 343980);        // [L..., R...]
const { stems } = await sess.run({ mix: new ort.Tensor("float32", mix, [1, 2, 343980]) });
const d = stems.data as Float32Array;            // [4][2][343980]; vocals L = d.subarray(6*343980, 7*343980), R = d.subarray(7*343980, 8*343980)
```

## Appendix C: Reference files from the original Python project

Re-read these files while you port the code: `lsync/alignment.py` for the
trellis and the backtrack, `lsync/lyrics_processor.py` for the segment and merge
steps, `lsync/lrc_formatter.py` for the LRC output, `lsync/util.py` for the 15 s
framing, `lsync/voice_extractor.py` for the Demucs call, and `lsync/eval.py` for
the metrics. Clone the project with
`git clone --depth 1 https://github.com/mikezzb/lyrics-sync /tmp/lyrics-sync`.
