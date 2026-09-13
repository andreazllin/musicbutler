# musicbutler: v1 Implementation Plan

**Status:** specification. No code exists yet.
**Audience:** an AI coding agent that builds this repository from end to end.

---

## 0. How to read this document

- An item marked **DECIDED** is binding. Do not reopen it. Do not substitute an
  equivalent library. Do not improve it during implementation.
- An item marked **NEEDS-INPUT** is unresolved. Each one names the milestone that
  it blocks. Each one also gives the default to use when no answer arrives. Only
  that milestone waits. All other work continues.
- Work through the milestones in order. See §10. A milestone is complete only
  after you run the listed commands and they pass.
- Do not add a feature that this document does not list. If a requirement here
  looks wrong, write the concern in `docs/DECISIONS.md`. Then build the
  requirement as written and continue.
- Record every judgement call in `docs/DECISIONS.md`. Use one line per call:
  `<date> | <decision> | <why>`.

**Companion documents.** Two other documents live in `docs/`. Read both before
you start.

1. `docs/lyrics-sync-functionality-implementation-plan.md` specifies the forced
   alignment engine. It is the authority on that engine.
2. `docs/frontend-structure.md` specifies the frontend architecture. It is the
   authority on folder layout and React conventions.

Those documents disagree with parts of this one. §13 lists every difference and
gives a resolution. Read §13 before you write code.

---

## 1. Product

musicbutler is a self-hosted web tool that maintains a Navidrome music library.

**v1 ships one tool: Lyrics Sync.** With it a user does four things. The user
browses the library. The user creates or edits the `.lrc` file for a song. The
user checks the result by listening. The user generates the timestamps
automatically, and the generator aligns the lyrics against the audio.

**Later tools** are out of scope for v1, but the shell must not block them.
Examples are track and album metadata editing, artwork, and tag cleanup. The
sidebar and the server router are registries, so a second tool adds entries and
changes nothing else. See §7.1 and §6.1.

---

## 2. Architecture: DECIDED

This project needs a backend. That is settled, for three reasons:

1. Forced alignment runs `onnxruntime-node` and `@huggingface/transformers`.
   Those use native bindings, at least 160 MB of model weights, and seconds of
   CPU time per track. A browser cannot run them.
2. The app reads and writes files inside the Navidrome library volume. Only a
   server process holds that mount.
3. Audio decoding needs `ffmpeg` for flac, m4a, and ogg.

| Package | Runtime | Responsibility |
| --- | --- | --- |
| `apps/server` | Bun + Hono + tRPC v11 | Library filesystem access. `.lrc` read, write, and delete. Audio streaming. Alignment job orchestration. Serves the built frontend in production |
| `apps/web` | Vite + React + TypeScript | The user interface |
| `packages/lrc` | pure TS, zero dependencies | LRC parse, serialize, validate, and timestamp math. Used by both the web app and the server |
| `packages/align` | TS, server only | The alignment pipeline. See §8. No HTTP, no tRPC, and no filesystem policy. It takes an audio path and lyric lines. It returns timings |
| `packages/shared` | pure TS | Cross-cutting constants and types: the supported audio extensions, the path types, and the job event types |

Use **Bun workspaces**. Run `bun install` at the root. Do not add Nx or Turbo.

---

## 3. Repository layout

```
musicbutler/
├── docker-compose.yml            # PUBLISHED image, no `build:` key (§9.3)
├── docker-compose.dev.yml        # local build, bind mounts, hot reload
├── Dockerfile
├── .dockerignore
├── .env.example
├── package.json                  # workspaces + root scripts
├── biome.json
├── tsconfig.base.json
├── .github/
│   └── workflows/
│       ├── ci.yml                # typecheck + lint + test on PR
│       └── release.yml           # multi-arch build → ghcr.io (§9.4)
├── docs/
│   ├── PLAN.md                   # this file
│   ├── lyrics-sync-functionality-implementation-plan.md   # the align engine
│   ├── frontend-structure.md     # the frontend architecture
│   ├── RELEASE.md                # release runbook (§9.4)
│   └── DECISIONS.md              # append-only log
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts          # Hono app, tRPC adapter, static serving, /healthz
│   │   │   ├── env.ts            # parsed + validated config (Zod)
│   │   │   ├── trpc.ts           # router/procedure builders, error mapping
│   │   │   ├── routers/
│   │   │   │   ├── index.ts      # appRouter = { library, lrc, sync }
│   │   │   │   ├── library.ts
│   │   │   │   ├── lrc.ts
│   │   │   │   └── sync.ts
│   │   │   ├── fs/
│   │   │   │   ├── paths.ts      # THE ONLY place that resolves user paths
│   │   │   │   └── library.ts    # THE ONLY place that touches fs
│   │   │   ├── http/
│   │   │   │   └── stream.ts     # GET /media/stream (HTTP Range)
│   │   │   └── jobs/
│   │   │       └── registry.ts   # in-memory job store + event emitter
│   │   └── test/
│   └── web/                      # layout per docs/frontend-structure.md
│       ├── index.html
│       ├── vite.config.ts
│       ├── postcss.config.cjs     # postcss-preset-mantine
│       └── src/
│           ├── main.tsx           # entry: Mantine CSS, providers, router mount
│           ├── styles/
│           │   └── globals.css    #    page frame and element defaults
│           ├── components/
│           │   └── layout/        # AppShell, Sidebar, nav items
│           ├── router/            # route table, guards
│           ├── layouts/           # page shells
│           ├── pages/             # route components (thin)
│           ├── stores/            # Zustand stores (small)
│           ├── lib/
│           │   ├── trpc.ts
│           │   ├── query-client.ts
│           │   ├── axios.ts       # media/binary routes only (§4.2)
│           │   ├── env.ts         # Zod-parsed env, fails fast at boot
│           │   └── format.ts      # mm:ss.xx display helpers
│           └── features/
│               ├── registry.ts    # ToolDefinition[] → sidebar + routes
│               └── lyrics-sync/
│                   ├── components/
│                   │   ├── FileTree.tsx
│                   │   ├── TreeNode.tsx
│                   │   ├── LrcEditor.tsx
│                   │   ├── SyncButton.tsx
│                   │   ├── SyncConfirmDialog.tsx
│                   │   ├── SyncProgress.tsx
│                   │   ├── AudioPlayer.tsx
│                   │   └── LyricPreview.tsx
│                   ├── editor/{lrc-language.ts,lrc-lint.ts,theme.ts}
│                   ├── hooks/{use-library-tree.ts,use-lrc-file.ts,use-sync-job.ts,use-audio-clock.ts}
│                   ├── constants/
│                   └── helpers/
└── packages/
    ├── lrc/src/{index.ts,parse.ts,serialize.ts,time.ts,detect.ts}  + test/
    ├── align/                    # see §8 and §13.1
    └── shared/src/index.ts
```

---

## 4. Tech stack: DECIDED

`docs/frontend-structure.md` §1 holds the full frontend stack table. The table
below repeats the choices that the server and the build also depend on. Where the
two tables differ, the frontend document wins for frontend concerns.

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime and package manager | Bun | Verified for the ML dependencies. See §8.1 |
| Server HTTP | Hono | Serves tRPC, `/media/stream`, and static assets |
| API layer | tRPC v11 | End to end types, no code generation |
| Server input validation | Zod | Every procedure input uses a Zod schema. No exceptions |
| Frontend build | Vite + React 19 + TS (`strict: true`) | |
| Routing | TanStack Router | Per the frontend document |
| Server state | TanStack Query, through `@trpc/tanstack-react-query` | |
| Client state | Zustand | One store per feature. Keep it small |
| URL state | nuqs | The selected song path lives in the URL, base64url-encoded. See §13.6 |
| Components | **Mantine**, <https://mantine.dev> | An npm dependency, not vendored source. Its own CSS variables and color scheme. See §4.1 |
| Icons | `@tabler/icons-react` | The set Mantine documents. Do not add a second icon set |
| HTTP client | axios | See §4.2 |
| Editor | CodeMirror 6 + a custom LRC mode | See §7.4 |
| Tests | `bun test` | |
| Lint and format | Biome | One binary for both. See §13.3 |

### 4.1 Mantine: how this project uses it

Mantine is an installed package. Nothing is vendored, so there is no component
source to review or to keep in step with an upstream. Follow these rules:

- The packages are `@mantine/core`, `@mantine/hooks`,
  `@mantine/notifications` and `@tabler/icons-react`. The build needs
  `postcss`, `postcss-preset-mantine` and `postcss-simple-vars` as dev
  dependencies, wired through `apps/web/postcss.config.cjs`.
- **Import the stylesheets once, in `main.tsx`, before any CSS module.**
  `@mantine/core/styles.css` then `@mantine/notifications/styles.css`.
  Import order decides which rules win.
- **`MantineProvider` wraps the app**, in the providers module. It carries the
  theme from `lib/theme.ts`: the brand scale, the fonts and the default radius.
  Everything else stays at the Mantine default. Do not start a second design
  system beside it.
- **Dark mode is Mantine's.** `useMantineColorScheme` reads and writes the
  scheme; Mantine persists it in `localStorage` under
  `mantine-color-scheme-value` and sets `data-mantine-color-scheme` on
  `<html>`. A Vite SPA has no server to render `<ColorSchemeScript>`, so the
  inline script in `index.html` replays the stored value before the first
  paint. Keep that key and that attribute equal to what `@mantine/core` reads.
- **Style with props first.** `Group`, `Stack`, `Flex`, `Box` and the style
  props (`p`, `gap`, `fz`, `c`, `flex`) cover most layout. Reach for a CSS
  module only for what props cannot say: hover and selected states, the
  CodeMirror host, the column resizer. Never hard-code a color; use the
  `--mantine-*` variables so both schemes follow.
- Use Mantine components for everything they cover: buttons, modals, tooltips,
  selects, sliders, tabs, badges, progress bars, notifications and the library
  tree. `Tree` with `useTree` provides the tree, including keyboard support and
  lazy children through `onLoadChildren`. Build custom UI only where nothing
  exists, which today means the LRC editor (§7.4) and the column resizer.
- `useTree` keeps the callbacks it was given on the first render. A handler
  that must read changing data reads it from a ref, not from a closure.

### 4.2 axios and tRPC: both, for different jobs

tRPC owns all RPC traffic. It uses its own links, not axios. axios serves the
routes that are not RPC, which today means `GET /media/stream` and any future
download or upload. Both clients exist on purpose.

`apps/web/src/lib/axios.ts` holds the axios instance. Its interceptors set the
base URL, pass through the basic-auth credentials, and normalize errors. Per
`docs/frontend-structure.md` §3.4, cross-cutting request behavior belongs in an
interceptor and not at a call site.

Do **not** wrap axios in a tRPC `fetch` adapter. It gains nothing and it breaks
SSE subscriptions.

---

## 5. Domain rules and invariants

### 5.1 The `.lrc` file name: DECIDED

For the audio file `<dir>/<base>.<ext>`, the lyrics file is exactly
`<dir>/<base>.lrc`. It uses the same directory and the same base name. It
replaces the extension with a lower case `.lrc`. The app never writes or deletes
any other file.

### 5.2 Save behavior: DECIDED

| Editor content | `.lrc` file exists | Action |
| --- | --- | --- |
| empty or whitespace only | yes | **delete** the `.lrc` file |
| empty or whitespace only | no | do nothing. This is not an error |
| not empty | either | **write** the `.lrc` file |

Every write is atomic. Write to `<base>.lrc.tmp-<random>` in the same directory.
Call `fsync`. Then rename that file over the target. Use UTF-8 with no BOM. Use
LF line endings. End the file with exactly one newline. Set the file mode to
`0644`.

### 5.3 Path safety: DECIDED

Every path that crosses the API is **relative to the library root**. It uses
POSIX separators and no leading slash, for example
`Artist/Album/01 Track.flac`. The depth is whatever the library happens to use:
nothing assumes an artist and album pair, so a path may hold any number of
segments.

`apps/server/src/fs/paths.ts` is the only module that may turn such a path into
an absolute path. It must do three things:

1. Reject any string that holds a NUL character, a backslash, or a `..` segment
   after `path.normalize`.
2. Resolve `realpath` on the result. Reject the path unless it equals
   `MUSIC_DIR` or starts with `MUSIC_DIR + path.sep`. This step is what stops a
   symlink escape.
3. Reject with the tRPC code `FORBIDDEN`. The message must not repeat the input
   path.

No other server module may import `node:fs` or `Bun.file`. Enforce that with the
Biome rule `noRestrictedImports`, scoped to `apps/server/src/**` and excluding
`fs/`.

### 5.4 Deletion guard: DECIDED

Immediately before it unlinks a file, `library.deleteLrc` must assert two facts.
The resolved target ends with `.lrc`. Its base name matches the base name of a
real audio file in the same directory. Any other path is a bug, so throw. Add a
unit test that tries to delete a `.flac` file, a `.jpg` file, and a `.lrc` file
that has no matching audio file.

### 5.5 Visible files: DECIDED

The tree shows directories and audio files only. It hides `.lrc` files as
entries. Instead each audio file carries a `hasLrc: boolean` flag, which the UI
shows as a badge. The tree also hides dotfiles, `@eaDir`, `.DS_Store`, and every
other non-audio file.

The supported audio extensions live in `packages/shared`: `.mp3 .flac .m4a .aac
.ogg .opus .oga .wav .wv .wma .aiff .aif .ape .mpc .dsf`. Match them without
regard to case.

### 5.6 The LRC format: DECIDED

- **Metadata tag.** `[key:value]`, where `key` is alphabetic. The known keys are
  `ti ar al au by offset length re ve`. Keep an unknown alphabetic key exactly
  as it arrived.
- **Line timestamp.** `[mm:ss]`, `[mm:ss.xx]`, or `[mm:ss.xxx]`. `mm` may exceed
  59, and the parser does not convert it to hours. One line may carry several
  timestamps, which marks a repeated lyric. Expand such a line into separate
  timed lines during the parse.
- **Word timestamp (enhanced LRC).** The inline form `<mm:ss.xx>`. Parse it and
  keep it. The alignment engine emits word timestamps by default, so this form
  is not optional. See §13.8.
- **Canonical output.** Write the metadata block first, in the order that it
  arrived. Then write one blank line. Then write the timed lines, sorted
  ascending and stable for ties. Format a line time as `[mm:ss.xx]` with zero
  padded minutes and two centisecond digits. Format a word time as
  `<mm:ss.xx>`.
- `parse(serialize(doc))` must equal `doc` for every fixture.

**One edge case is critical.** `[ti:Title]` is metadata, not a timestamp. A
timestamp needs digits before the colon. A loose pattern such as
`\[.+:.+\]` gets this wrong, and the detector in §7.5 then takes the wrong
branch. Write a test for it.

### 5.7 Test fixture rule: DECIDED

Lyric and LRC test fixtures use synthetic placeholder text, such as `line one`
or `la la la`. Public domain verse is also acceptable. Never commit copyrighted
song lyrics to this repository. The alignment engine tests satisfy this rule by
generating speech with the macOS `say` command.

---

## 6. The server contract

### 6.1 Router shape

`appRouter = { library, lrc, sync }`. A future tool adds one sibling key and
changes nothing else.

### 6.2 Procedures

```ts
// ---- library ----
// One directory at a time. Kept for callers that want a single listing.
library.list
  input:  { path: string }                    // "" = library root
  output: { path: string; parent: string | null; entries: Entry[] }

// The whole library in one walk, so the web tree can search every folder and
// song without the user opening them first. Stops at LIBRARY_TREE_MAX_NODES and
// says so, because a real library can hold hundreds of thousands of files.
library.tree
  input:  none
  output: { children: TreeEntry[]; count: number; truncated: boolean }

type TreeEntry =
  | { kind: 'dir';   name: string; path: string; children: TreeEntry[] }
  | { kind: 'audio'; name: string; path: string; ext: string; hasLrc: boolean }

type Entry =
  | { kind: 'dir';   name: string; path: string; childCount: number }
  | { kind: 'audio'; name: string; path: string; ext: string;
      sizeBytes: number; mtimeMs: number; hasLrc: boolean }
// Sort: dirs first, then audio. Natural-sort each group (numeric-aware,
// case-insensitive) so that "2 Track" precedes "10 Track".

// ---- lrc ----
lrc.get
  input:  { audioPath: string }
  output: { lrcPath: string; exists: boolean; content: string; mtimeMs: number | null }
                                              // exists:false → content: ""

lrc.save
  input:  { audioPath: string; content: string; expectedMtimeMs: number | null }
  output: { action: 'written' | 'deleted' | 'noop'; mtimeMs: number | null }
// expectedMtimeMs is the mtime that the client last saw.
// null means "the client expects no file".
// A mismatch returns the tRPC code CONFLICT.
// The UI then offers reload or overwrite.

// ---- sync ----
sync.start
  input:  { audioPath: string;
            lyrics: string;                   // raw editor text
            lang: 'en-US' | 'it-IT';          // see §13.13
            options?: { isolateVocals?: boolean; leadInMs?: number;
                        wordTimestamps?: boolean } }
  output: { jobId: string }
// Returns CONFLICT when a job already runs. v1 runs one job at a time.

sync.languages                                // which ASR models this build holds
  output: { langs: Array<{ code: 'en-US' | 'it-IT'; label: string; available: boolean }> }

sync.progress                                 // tRPC subscription over SSE
  input:  { jobId: string }
  yields: SyncEvent

type SyncEvent =
  | { type: 'progress'; stage: SyncStage; pct: number; message?: string }
  | { type: 'done'; content: string; mtimeMs: number }   // the .lrc is already written
  | { type: 'error'; code: string; message: string }
type SyncStage = 'queued'|'decode'|'separate'|'transcribe'|'align'|'write'

sync.cancel
  input:  { jobId: string }
  output: { cancelled: boolean }
```

### 6.3 Routes that are not tRPC

- `GET /media/stream?path=<library-relative>` returns audio bytes. It **must**
  implement HTTP `Range`, which means a 206 status, a `Content-Range` header,
  and `Accept-Ranges: bytes`. It must also send the correct `Content-Type` for
  the extension, plus `ETag` and `Last-Modified`. Without Range support the seek
  bar does not work in Safari or Chrome.
- `GET /healthz` returns
  `{ ok: true, musicDirWritable: boolean, modelsReady: boolean }`.
- `GET /*` serves the built frontend. Production only.

### 6.4 Configuration

`env.ts` parses the configuration with Zod and fails at boot when a value is
wrong. The variables are `MUSIC_DIR` (required, must exist, must be a
directory), `MODEL_CACHE_DIR` (default `/models`), `PORT` (default `3000`),
`LOG_LEVEL`, and `FFMPEG_PATH` (default `ffmpeg`).

The server also exports `MODEL_CACHE_DIR` to the alignment engine as
`MUSICBUTLER_CACHE`, because that engine reads its own variable. See §13.14.

---

## 7. Frontend specification

`docs/frontend-structure.md` is the authority on folder layout, the hook
pattern, and the React conventions. This section specifies what the Lyrics Sync
feature does. Read both.

### 7.1 The shell

The shell holds a sidebar and a content area. The sidebar reads from
`features/registry.ts`:

```ts
type ToolDefinition = {
  id: string; label: string; icon: ReactNode;
  path: string;              // "/tools/lyrics-sync"
  element: () => ReactNode;  // lazy
};
```

The v1 registry holds one entry, Lyrics Sync. The route `/` redirects to it.

**The app holds no authentication.** It has no login screen. HTTP Basic Auth
runs in the reverse proxy in front of the container. See §9. The axios instance
and the tRPC links must send credentials with `withCredentials: true`, so that
the app reuses the basic-auth session of the browser.

### 7.2 State ownership: DECIDED

`docs/frontend-structure.md` §1.1 sets the three way split. Applied here:

- **TanStack Query owns every value that came from the server.** That covers
  directory listings, the saved `.lrc` content, its mtime, and the job state.
- **The URL owns the shareable view state.** That is the selected audio path,
  through nuqs, base64url-encoded so the query string does not show the folder
  layout of the library. A user can still link to a song. See §13.6.
- **Zustand owns the remaining UI state.** That covers the expanded tree nodes
  and the unsaved editor buffer. It also covers the dirty flag, the playback
  offset, the color scheme, and the open state of each dialog.

Never copy server data into Zustand. While the editor buffer is `null`, the
editor renders the content from the query. On the first keystroke, the buffer
takes over.

### 7.3 The Lyrics Sync screen

The screen holds two resizable columns.

**The left column holds the library tree.** The whole library arrives in one
`library.tree` query, so the filter can reach any folder or song without the
user opening the folders first. Per §5.5 the tree hides `.lrc` entries, and an
audio row shows a "has lyrics" badge. Selecting an audio row sets the selection
and loads the `.lrc` file for that song. If the buffer holds unsaved changes,
ask before you switch, and offer discard or cancel. The filter matches fuzzily
on both the name and the whole path, over folders and songs alike, and opens
the folders holding the matches. Search is client side: the tree is already in
memory, so the server does no matching.

Every data surface here handles three outcomes: pending, error, and empty. Build
them per `docs/frontend-structure.md` §4 item 3, and branch on `isPending`.

**The right column holds the editor.** From top to bottom:

1. A header with the song file name, the resolved `.lrc` path, and a dirty
   indicator.
2. The CodeMirror editor. See §7.4.
3. The sync checker, which is `AudioPlayer` plus `LyricPreview`. See §7.6.
4. An action row with **Save**, a language select, **Sync lyrics** (§7.5), and a
   destructive **Delete lyrics**. Delete lyrics clears the editor and saves,
   which deletes the file per §5.2.

When no song is selected, tell the user to pick one. Disable the editor. Do not
hide it.

### 7.4 The editor

Use CodeMirror 6 with a **custom LRC mode**. Implement the mode with
`StreamLanguage.define`. A full Lezer grammar is not worth the cost here.

The token classes are `lrc-timestamp`, `lrc-meta-key`, `lrc-meta-value`,
`lrc-word-time`, `lrc-text`, and `lrc-invalid`. Build the theme in
`editor/theme.ts` from Mantine's `--mantine-*` CSS variables. Read those
tokens. Do not pick new colors. The editor then follows the color-scheme
class with no JavaScript.

Add a linter in `editor/lrc-lint.ts` through the CodeMirror `linter()` helper.
Every diagnostic comes from `packages/lrc`:

- *error*: a malformed timestamp, such as `[1:2]` or `[99:99.99]`, or an
  unclosed bracket.
- *warning*: timestamps that do not increase.
- *warning*: a timestamp past the audio duration. This needs the loaded
  duration.
- *info*: a duplicate timestamp.

Also enable line numbers, `history`, `search`, and soft wrap. Turn bracket
matching off, because brackets are syntax in this format.

Keep `packages/lrc` free of any CodeMirror import. The mode and the linter are
thin adapters over it.

### 7.5 The "Sync lyrics" button: DECIDED state machine

`hasTimestamps(text)` from `packages/lrc/detect.ts` decides whether timestamps
exist. It returns true when a line matches
`/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/`, or when an inline `<\d{1,3}:\d{2}...>`
exists. A metadata tag must not trigger it. See §5.6.

| Editor text | Song selected | Job running | Button | Click behavior |
| --- | --- | --- | --- | --- |
| empty or whitespace | any | any | **disabled**, tooltip "Write the lyrics first" | none |
| any | no | any | **disabled**, tooltip "Select a song" | none |
| any | yes | yes | **disabled** with a spinner, Cancel visible | none |
| text, **no** timestamps | yes | no | **enabled** | start the sync at once |
| text, **has** timestamps | yes | no | **enabled** | open the confirm dialog, then start the sync on confirm |

The confirm dialog must state two facts plainly. The sync discards the existing
timestamps and generates new ones. The sync also overwrites the `.lrc` file.
Focus Cancel by default.

On a `done` event, replace the editor document with the returned content, clear
the dirty flag, and invalidate the `lrc.get` query for that path. A successful
sync writes the file on the server, so the user does not press Save afterwards.
Say that in the dialog.

On an `error` event, leave the editor untouched, show the message, and leave the
button enabled.

The language select next to the button sets the `lang` input of `sync.start`. It
reads its options from `sync.languages` and disables any language whose model
the build does not hold. Default to the first available language.

### 7.6 The sync checker

- Use `<audio src="/media/stream?path=...">` with `preload="metadata"`.
- Provide play and pause, a seek bar, an `mm:ss.xx` readout, a volume control,
  and the speeds 0.75x, 1x, and 1.25x.
- `LyricPreview` renders the parsed lines and highlights the active one. Drive
  the highlight from `requestAnimationFrame`. Do not drive it from `timeupdate`,
  which fires about four times per second and looks broken. Find the active line
  with a binary search over the timestamp array. Auto-scroll to keep that line
  centered. Suspend auto-scroll for 3 s after the user scrolls by hand.
- Clicking a line seeks to its timestamp.
- Add an offset control from −5.00 s to +5.00 s in 10 ms steps. It applies at
  preview time only. Next to it add an **Apply offset to document** button. That
  button shifts every timestamp in the editor by the current offset, clamps the
  result at 0, and resets the control.
- Bind the keyboard only while the player holds focus. `Space` toggles play.
  `←` and `→` seek by 2 s.

Three things stay out of v1: a hotkey that stamps the current line, a waveform
display, and per-word karaoke rendering. Do not build them.

---

## 8. The alignment pipeline

`docs/lyrics-sync-functionality-implementation-plan.md` is the authority on this
pipeline. That document specifies the modules, the algorithms, the tests, and
the pitfalls. It targets a standalone library called musicbutler. §13.1 resolves
how this repository consumes it.

Read that document in full before you start milestone M7. Do not restate its
algorithms here, and do not implement a second version of them.

### 8.1 The facts already verified on this machine, macOS arm64, Bun 1.3.14

Do not verify these again. The companion document §0 holds the full table. The
short form:

- `@huggingface/transformers@4.2.0` loads `Xenova/wav2vec2-base-960h` at `q8`
  with `Wav2Vec2ForCTC` and returns logits. Load `AutoTokenizer` separately,
  because the wav2vec2 `AutoProcessor` has no `.tokenizer`. In that model the
  CTC blank is `<pad>` at id 0 and the word delimiter is `|` at id 4. Those two
  ids belong to that model only. Read them from the tokenizer.
- `inputs_to_logits_ratio` is undefined in the JS config. Use 320 samples at
  16 kHz, which is **20 ms per frame**. This holds for every wav2vec2 variant.
- `onnxruntime-node@1.24.3` runs `StemSplitio/htdemucs-onnx`
  (`htdemucs_fp16weights.onnx`, 158 MB) under Bun. The input `mix` is
  `[1,2,343980]` at 44.1 kHz. The output `stems` is `[1,4,2,343980]`, and
  **vocals is stem index 3**. One 7.8 s chunk takes about 1.3 s on CPU. The
  graph performs STFT and iSTFT internally, so this project writes no DSP code.
- `onnxruntime-node` needs a trusted postinstall script. Run
  `bun pm trust --all` and declare `trustedDependencies` in `bunfig.toml`. The
  Dockerfile must do the same. See §13.15.

### 8.2 Stages

The companion document §3 holds the authoritative diagram. The stages are
decode, separate, transcribe, normalize the lyrics, align, and write. The
server maps each stage to one `SyncStage` value from §6.2.

Two musicbutler specific rules apply on top of that pipeline:

1. The lyric source is the raw editor text. Before you normalize it, drop the
   metadata tags and any existing timestamps. Also drop blank lines and
   bracketed section markers such as `[Chorus]`. A section marker is neither
   metadata nor a timestamp.
2. The write stage subtracts `leadInMs` from each line start, clamps the result
   at 0, serializes through `packages/lrc`, and writes the file per §5.2. It
   then emits `done` with the content.

Emit a `progress` event at every stage boundary. Also emit one at least every
2 s inside the separate stage and the transcribe stage. A 4-minute English track
takes about 70 s in total, so silent gaps are long enough to look like a hang.

### 8.3 Models

`scripts/fetch-models.ts` downloads the weights into `MODEL_CACHE_DIR`. The
Dockerfile runs it **at build time**, so the weights ship inside the published
container image. See §9.2. A fresh container then downloads nothing on the
request path. It works on first boot, on a metered connection, and offline.
Point the transformers cache variable at the same directory. `/healthz` reports
`modelsReady`, which must be `true` right after `docker compose up`, with no
warm-up.

The Italian model is much larger than the English model, and no ONNX export is
verified yet. §13.16 holds the resulting decision about the image.

### 8.4 Testability

The alignment package must expose its pure functions with unit tests over
synthetic logits. The companion document §5.8 and §5.9 name them. `bun test`
must download no model. Put every test that touches ONNX behind an integration
test that skips when the models are absent.

---

## 9. Deployment and distribution

### 9.1 Distribution model: DECIDED

The whole application ships as **one public, free container image on the GitHub
Container Registry**. Anyone can pull it without a login. It supports several
architectures.

```
ghcr.io/<owner>/musicbutler:<version>
```

The target experience is exactly this, on a machine that has never seen this
repository:

```bash
mkdir musicbutler && cd musicbutler
curl -O https://raw.githubusercontent.com/<owner>/musicbutler/main/docker-compose.yml
echo 'NAVIDROME_MUSIC_DIR=/path/to/your/music' > .env
docker compose up -d
```

No clone. No `bun install`. No local build. No `docker login`. Nothing paid.
Treat that block as an acceptance test of the design. If a requirement breaks
it, the requirement is wrong.

These rules follow from it:

- **The root `docker-compose.yml` names a published `image:`. It must hold no
  `build:` key.** Local building lives in `docker-compose.dev.yml` only. A
  compose file that needs the source tree fails the goal above.
- **Use `ghcr.io` only.** Do not use Docker Hub, which rate limits anonymous
  pulls. Do not use a paid registry. A public package on GHCR is free, and it
  does not count against the storage or bandwidth limits of a public repository.
- **This project builds exactly one image.** The server serves the built
  frontend, so no separate web container exists. Any other service in the
  compose file must be an existing public upstream image, for example
  `caddy:2-alpine` for basic auth. Never build and publish a second image.
- **An anonymous pull must work.** GHCR makes a package private on the first
  push. Somebody must flip the package visibility to Public by hand, once, in
  the package settings. Put that step in `docs/RELEASE.md`. It is the most
  common reason that a supposedly public image returns 401 for everyone else.
- **Build `linux/amd64` and `linux/arm64`.** Apple Silicon and ARM NAS devices
  are primary targets. x86 servers are the other half. A single architecture
  image is not acceptable.

### 9.2 Image contents

Use a multi-stage `Dockerfile`:

1. The build stage runs `bun install --frozen-lockfile`, builds `apps/web`, and
   prunes to the production dependencies of `apps/server`. It also runs
   `bun pm trust --all`, per §8.1.
2. The model stage runs `scripts/fetch-models.ts` into `/models` as its **own
   layer**. The weights then stay cached, and a code-only change does not push
   them again.
3. The runtime stage holds Bun, `ffmpeg`, the server bundle, the built frontend,
   the models, `wget` for the healthcheck, and a non-root `app` user.

Accept two consequences and document them. Do not engineer around them. The
image is large, and the first pull is slow. With the English model alone, expect
roughly 1.2 GB to 1.5 GB, and the ONNX weights dominate that figure. The Italian
model adds several hundred megabytes more. See §13.16 for how to handle that.
This size buys a container that works at once, offline, with no runtime
download. For a self-hosted tool that is the right trade.

At build time, verify that `onnxruntime-node` and `@huggingface/transformers`
resolve **prebuilt native binaries for both architectures**. If arm64 has no
prebuilt binary, stop and report it. Do not fall back to a single architecture
image in silence. Do not compile ONNX Runtime from source inside CI without
asking first.

Set the OCI labels through `docker/metadata-action`. Include
`org.opencontainers.image.source=https://github.com/<owner>/musicbutler`. That
label links the package to the repository, which makes the package appear on the
repository page.

### 9.3 The published `docker-compose.yml`

```yaml
services:
  musicbutler:
    image: ghcr.io/<owner>/musicbutler:latest   # pin a version for stability
    environment:
      MUSIC_DIR: /music
      PORT: "3000"
      # PUID/PGID: must match the owner of your music library
      PUID: "${PUID:-1000}"
      PGID: "${PGID:-1000}"
    volumes:
      # read-write on purpose: this is where .lrc files are written
      - ${NAVIDROME_MUSIC_DIR:?set NAVIDROME_MUSIC_DIR in .env}:/music
    ports:
      - "127.0.0.1:3000:3000"   # never 0.0.0.0 without the auth proxy below
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3

# Uncomment to expose musicbutler beyond localhost behind HTTP basic auth.
# Generate the hash with: docker run --rm caddy:2-alpine caddy hash-password
#
#  caddy:
#    image: caddy:2-alpine
#    ports: ["8080:8080"]
#    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
#    depends_on: [musicbutler]
```

The file declares no models volume, because the weights live in the image. See
§9.2. `MODEL_CACHE_DIR` stays available as an override for anyone who mounts
their own weights.

`.env.example` holds `NAVIDROME_MUSIC_DIR`, `PUID`, and `PGID`, and nothing
else. Every other setting must have a working default.

### 9.4 The publishing workflow: `.github/workflows/release.yml`

- Trigger on a push to `main` and on a pushed tag that matches `v*`. Also allow
  `workflow_dispatch`.
- Set `permissions: { contents: read, packages: write }`.
- Log in to `ghcr.io` with `docker/login-action` and the built-in
  `GITHUB_TOKEN`. This needs no personal access token and no repository secret.
- Use `docker/setup-qemu-action` and `docker/setup-buildx-action` with
  `platforms: linux/amd64,linux/arm64`. arm64 under QEMU is slow. If the build
  passes the runner limit, move to native ARM runners, or split the build into
  one job per architecture and join them with a manifest. Do not drop arm64.
- Produce the tags with `docker/metadata-action`: `latest` on the default
  branch, the semver tags `1.2.3`, `1.2`, and `1` on a version tag, and the
  commit `sha`.
- Cache the layers, so that a code-only change does not download the models
  again.
- Do not run the release job when `ci.yml` fails.

`docs/RELEASE.md` holds the runbook. It must include the one-time step that
flips the GHCR package to Public.

### 9.5 Local development

`docker-compose.dev.yml` holds `build: .`, the source bind mounts, and
`bun --watch`. Daily frontend work needs no Docker at all. Run `bun run dev` at
the root. That starts Vite and the server, with `MUSIC_DIR` pointed at a fixture
directory.

### 9.6 What the README must state

- The copy-paste quickstart from §9.1. Include the compose file inline, so that
  the user clones nothing.
- Upgrading: `docker compose pull && docker compose up -d`.
- The music volume is mounted **read-write**. That is the point, because the app
  writes `.lrc` files into the library. Point it at a copy first. Confirm the
  behavior before you point it at the real library.
- Navidrome must be able to read the written files. Set `PUID` and `PGID` to the
  owner of the library. The app writes mode `0644`.
- Navidrome finds external `.lrc` files during a scan. A new file may not appear
  in a Navidrome client until the next scan. v1 holds no Navidrome API
  integration. See §12.3.
- The app holds no basic auth. The published compose file binds to `127.0.0.1`.
  Exposing it wider needs the commented `caddy` service.
- The image size and the first pull time, with the reason, which is the bundled
  ML models.
- Which languages the image supports, and the size cost of each. See §13.16.

---

## 10. Milestones

Every milestone ends green. Run `bun run typecheck && bun run lint && bun test`.

**M1: Scaffold.** Set up Bun workspaces and `tsconfig.base.json` with `strict`
and no `any`. Add `biome.json`. Add the root scripts `dev`, `build`,
`typecheck`, `lint`, and `test`. Create `packages/shared` with the extension
list. Create an empty `docs/DECISIONS.md`.
*Done when* every root script runs and passes on an empty codebase.

**M2: `packages/lrc`.** Implement parse, serialize, `hasTimestamps`,
`shiftTimestamps`, `formatTime`, `parseTime`, and `validate`, which returns
diagnostics.
*Done when* the round-trip tests pass for every case below. Write 25 test cases
or more.

1. Line level timestamps.
2. Enhanced word level timestamps.
3. One line that carries several timestamps.
4. A file that holds metadata only.
5. `[ti:...]` against a real timestamp.
6. `mm` above 59.
7. CRLF input.
8. A file with no trailing newline.
9. The empty string.
10. Garbage lines.

**M3: Server filesystem and library API.** Implement `env.ts`, `fs/paths.ts`,
`fs/library.ts`, `library.list`, `lrc.get`, and `lrc.save`. Add the Biome
`noRestrictedImports` rule.
*Done when* the path traversal tests all reject their input. Cover `../`, an
absolute path, a symlink that points outside the library, and a NUL byte. The
deletion guard tests from §5.4 must pass. Cover save, delete, the no-op case,
and the mtime `CONFLICT` path against a temporary fixture library.

**M4: Media streaming.** Implement `GET /media/stream` with Range support, and
`/healthz`.
*Done when* a request with `Range: bytes=100-199` returns 206, the correct 100
bytes, and a `Content-Range` header. A full request returns 200 with the right
`Content-Type`. Seeking works in a real browser.

**M5: Web shell.** Install Mantine and `postcss-preset-mantine`. Wire
`MantineProvider`, the color-scheme toggle with persistence, the React
Aria `RouterProvider`, TanStack Router, the feature registry, the sidebar, tRPC,
TanStack Query, nuqs, and the axios instance.
*Done when* all five checks pass:

1. The app boots.
2. The sidebar shows Lyrics Sync, and `/` redirects to it.
3. One live tRPC call renders real data from the server.
4. Switching the color scheme restyles the whole app, and the choice survives a
   reload.
5. A sidebar link navigates without a page reload.

**M6: The Lyrics Sync screen.** Build the file tree and the editor with the LRC
mode and the linter. Then build the save behavior, the dirty-state guards, the
conflict handling, and the pending, error, and empty states.
*Done when* all five checks pass against a fixture library:

1. Typing lyrics and saving creates the `.lrc` file on disk.
2. Editing that file and saving updates it.
3. Clearing the editor and saving removes the file from disk.
4. A `.lrc` file never appears as a tree row, but the badge does appear.
5. Switching songs with unsaved changes asks first.

**M7: Alignment.** Build the alignment package per
`docs/lyrics-sync-functionality-implementation-plan.md`. Then add
`jobs/registry.ts`, the `sync.*` procedures, the SSE progress stream, the button
state machine, the confirm dialog, the progress UI, the language select, and
cancel. §13.1 states where that package lives.
*Done when* all three checks pass:

1. Every row of the §7.5 table works in the browser.
2. A real track produces a `.lrc` file. A person judges its timestamps correct
   in the sync checker.
3. Cancelling a job mid-run leaves the original file untouched.

**M8: Sync checker polish.** Build the active line highlight, click to seek, and
the offset control with apply-to-document.
*Done when* all three checks pass:

1. The highlight tracks the audio within about 100 ms.
2. Apply-offset shifts every timestamp in the document.
3. The editor undo reverses that shift in one step.

**M9: Container, publishing, and docs.** Write these files: the multi-stage
Dockerfile with the models baked in, `.dockerignore`, the published
`docker-compose.yml` with no `build:` key, `docker-compose.dev.yml`,
`.env.example`, `ci.yml`, `release.yml`, the README per §9.6, and
`docs/RELEASE.md`. The runbook must include the step that flips the GHCR
package to Public.
*Done when* all of the following are verified for real, not reasoned about:

1. `docker compose -f docker-compose.dev.yml up --build` serves the app against
   a copied fixture library, edits a `.lrc` file, and completes one sync.
2. `/healthz` reports `musicDirWritable` and `modelsReady` as true, in a
   container that has had no network access since it started.
3. `release.yml` pushes to `ghcr.io`, and
   `docker buildx imagetools inspect ghcr.io/<owner>/musicbutler:latest` lists
   **both** `linux/amd64` and `linux/arm64`.
4. After `docker logout ghcr.io`, the command
   `docker pull ghcr.io/<owner>/musicbutler:latest` succeeds. The package is
   really public.
5. The §9.1 quickstart works exactly as written, in an empty directory that
   holds only the downloaded compose file and a one-line `.env`.

---

## 11. Non-goals for v1

The app holds no in-app authentication and no user accounts. It edits no
metadata, no tags, and no artwork. It calls no Navidrome API and reads no
Navidrome database. It fetches no lyrics from an external provider, because the
user supplies the words. It runs no speech-to-text transcription, because it
only aligns. It offers no library-wide batch sync. It supports no concurrency
beyond the mtime check. It has no mobile layout, because the target is the
desktop. Do not break at narrow widths, but do not design for them either.

The project publishes to no second registry and to no Docker Hub. It uses no
paid registry and no paid hosting. It ships no image that needs a login to pull.

---

## 12. Open questions

**12.1 The alignment algorithm document: RESOLVED.**
`docs/lyrics-sync-functionality-implementation-plan.md` is present. It is the
authority on the engine. §13 lists where it differs from this plan.

**12.2 The frontend structure document: RESOLVED.**
`docs/frontend-structure.md` is present. It is the authority on the frontend
layout and conventions. §13 lists where it differs from this plan.

**12.3 Should a `.lrc` write trigger a Navidrome rescan?**
If yes, supply the Navidrome base URL and the credentials. *Default:* no
integration. Document the scan delay in the README.

**12.4 Word level LRC output: RESOLVED, with one flag left open.**
The alignment engine produces word timings by default and writes them as
`<mm:ss.xx>` tags. So v1 writes word level output. `packages/lrc` must parse and
serialize both forms. See §13.8. Open: whether the confirm dialog offers a
line-level-only option. *Default:* offer it as the `wordTimestamps` flag in
`sync.start`, default true.

**12.5 The GitHub owner and repository name for the image. Blocks the M9
publish step only.**
Every `ghcr.io/<owner>/musicbutler` reference needs the real owner. *Default:*
read it from `git remote get-url origin`. If no remote exists yet, leave
`<owner>` as a literal placeholder in the docs. Keep the workflow using
`${{ github.repository_owner }}`, which stays correct on its own. Ask before the
first publish.

**12.6 Vocal isolation on by default?**
It roughly triples the sync time. It also improves the alignment on a dense mix
by a wide margin. *Default:* on, with a toggle in the confirm dialog.

**12.7 Who exports the Italian ASR model? Blocks Italian sync only.**
The companion document M7 needs a one-off Python export with `optimum-cli`. It
also needs a Hugging Face account to publish the result. *Default:* the agent performs the export
locally and reports the result. Ask before you publish anything to a public
Hugging Face account.

---

## 13. Differences between the three documents

The three documents in `docs/` were written separately. Where they disagree,
this table decides. Apply each resolution. Record any change of mind in
`docs/DECISIONS.md`.

| # | Topic | The disagreement | Resolution |
| --- | --- | --- | --- |
| 13.1 | Package boundary | The engine document was first written for a separate project with its own name. That name is gone | **RESOLVED.** One project, one name. The engine is the workspace package `packages/align` inside musicbutler. Keep its internal module layout exactly as the engine document specifies. Keep its CLI, because it is the fastest way to debug a bad alignment. Do not publish it to npm in v1 |
| 13.2 | Router | This plan named no router. The frontend document names TanStack Router | Use TanStack Router |
| 13.3 | Lint and format | This plan allowed ESLint or Biome. The frontend document names Biome | Use Biome. The filesystem import guard in §5.3 becomes the Biome rule `noRestrictedImports` instead of the ESLint rule |
| 13.4 | Folder layout | This plan used `src/tools/<tool>/`. The frontend document uses `src/features/<domain>/` with separate `pages/`, `router/`, and `layouts/` folders | Follow the frontend document. Read "tool" as "feature". Keep the registry in `src/features/registry.ts`, because the sidebar needs it |
| 13.5 | Component library | The frontend document says "vendored shadcn primitives" under `components/ui/` | Use Mantine from npm. Nothing is vendored, so `components/` holds app layout only |
| 13.6 | URL state | This plan held the selected song in Zustand. The frontend document puts shareable view state in the URL through nuqs | Put the selected audio path in the URL, base64url-encoded through a custom nuqs parser. A user can then link to a song and reload into it |
| 13.7 | Forms | The frontend document specifies react-hook-form and zod | Keep both available. v1 has almost no forms, so do not force them into the editor screen |
| 13.8 | LRC granularity | The engine writes word level tags by default. §12.4 of this plan defaulted to line level | Word level is the default. `packages/lrc` must round-trip both forms. The editor mode already has an `lrc-word-time` token |
| 13.9 | ASR window length | This plan said about 30 s. The engine document says 15 s, and it includes the final partial window | Use 15 s, per the engine document. It is specific and verified |
| 13.10 | Demucs overlap | This plan said about 1 s. The engine document says 25 percent of 343 980 samples, which is 85 995 samples | Use the engine document figure |
| 13.11 | Overlap-add window | This plan said a Hann cross-fade. The engine document says a linear fade in and fade out | Use the linear fade, per the engine document. It ports the reference `infer.py` |
| 13.12 | Vocals to mono | This plan said resample the vocals to mono. The engine document says average L and R, which beats the left-only Python version | Average L and R, then resample |
| 13.13 | Languages | This plan assumed English only. The engine document supports `en-US` and `it-IT` | Support both. `sync.start` takes a `lang` input. Add the `sync.languages` procedure and the language select in §7.5. Report a language as unavailable when the build holds no model for it |
| 13.14 | Model cache path | The engine reads `MUSICBUTLER_CACHE` and defaults to `~/.cache/musicbutler`. This plan uses `MODEL_CACHE_DIR` | The server sets `MUSICBUTLER_CACHE` to `MODEL_CACHE_DIR` at boot. One directory holds every model. See §6.4 |
| 13.15 | Bun trusted dependencies | The engine document requires `bun pm trust --all` and a `trustedDependencies` entry in `bunfig.toml`. This plan did not mention it | Add `bunfig.toml` at the repository root. Run `bun pm trust --all` in the Dockerfile build stage and in `ci.yml`. Without it the `onnxruntime-node` postinstall never runs |
| 13.16 | Image size and the Italian model | §9.2 sized the image around the English model. The Italian model is an xlsr-53 large or xls-r 300M export, which is several times larger | **NEEDS-INPUT, blocks the M9 size claim.** *Default:* bake the English model into the image. Make the Italian model a build argument, `WITH_IT_MODEL`, default off. Publish one extra tag, `latest-multilang`, that holds both. `sync.languages` then reports honestly per image, and the default image stays near 1.3 GB |
| 13.17 | Alignment memory | The engine document sizes the trellis at 72 MB for a 4-minute song and 360 MB for a 10-minute song with 3 000 tokens | Keep the one-job-at-a-time limit from §6.2, which bounds the peak. Report the early `AlignError` for `N > T` as a clear UI message, not as a crash |
| 13.18 | Evaluation dataset | The engine document evaluates against `f90/jamendolyrics`, which covers English | Keep that optional milestone. For Italian, hand annotate a few tracks and report line level error only. Say which method produced each number |
