# musicbutler

A self-hosted web tool that maintains a [Navidrome](https://www.navidrome.org/)
music library. v1 ships one tool, **Lyrics Sync**: browse the library, import or
write the words of a song, generate word-level timestamps by aligning those
words against the audio, and check the result by listening. A second screen,
**Sync queue**, shows the jobs that run and the jobs that wait.

The whole app is one container image: server, web UI, `ffmpeg` and the ML
models. It pulls without a login and works offline after the first pull.

## Quickstart

On a machine with Docker, in an empty directory:

```bash
mkdir musicbutler && cd musicbutler
curl -O https://raw.githubusercontent.com/andreazllin/musicbutler/main/docker-compose.yml
echo 'NAVIDROME_MUSIC_DIR=/path/to/your/music' > .env
docker compose up -d
```

Then open <http://localhost:3000>.

The compose file, in full:

```yaml
services:
  musicbutler:
    image: ghcr.io/andreazllin/musicbutler:latest   # pin a version for stability, e.g. :0.0.2
    environment:
      MUSIC_DIR: /music
      MUSICBUTLER_LANGS: "${MUSICBUTLER_LANGS:-en-US}"   # en-US, it-IT
      PORT: "3000"
      PUID: "${PUID:-1000}"   # must match the owner of your music library
      PGID: "${PGID:-1000}"
    volumes:
      - ${NAVIDROME_MUSIC_DIR:?set NAVIDROME_MUSIC_DIR in .env}:/music   # read-write on purpose
      - musicbutler-models:/models   # keeps a downloaded language
    ports:
      - "127.0.0.1:3000:3000"   # never 0.0.0.0 without the auth proxy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  musicbutler-models:
```

Upgrade with:

```bash
docker compose pull && docker compose up -d
```

## Read this before you point it at your library

- **The music volume is mounted read-write.** That is the point: the app writes
  `.lrc` files next to your audio files. It never writes or deletes any other
  file, and every write is atomic. Still, **point it at a copy first** and
  confirm the behavior before you point it at the real library.
- **Navidrome must be able to read the written files.** Set `PUID` and `PGID`
  to the owner of the library (`id -u`, `id -g` on the host). Files are written
  with mode `0644`.
- **Navidrome picks up external `.lrc` files during a scan.** A new file may
  not appear in a client until the next scan. v1 does not call the Navidrome API.
- **The app has no login.** The published compose file binds to `127.0.0.1`
  only. To expose it wider, uncomment the `caddy` service in the compose file,
  which adds HTTP basic auth in front of the container. Never publish port 3000
  on `0.0.0.0` without it.

## Languages

Set `MUSICBUTLER_LANGS` to the languages you want, comma separated:

```bash
echo 'MUSICBUTLER_LANGS=en-US,it-IT' >> .env
docker compose up -d
```

There is one image for every language. English is baked into it, so the
container works offline as soon as it starts. Any other language downloads once
on the first start, into the `musicbutler-models` volume, and stays there across
restarts and upgrades.

| Language | Acoustic model (ONNX, int8) | Source model | Download |
| --- | --- | --- | --- |
| `en-US` English | `linandrea/wav2vec2-large-960h-lv60-self-onnx` | `facebook/wav2vec2-large-960h-lv60-self` | baked in |
| `it-IT` Italian | `linandrea/wav2vec2-large-xlsr-53-italian-onnx` | `jonatasgrosman/wav2vec2-large-xlsr-53-italian` | 355 MB |

The image is about **1.7 GB** and the first pull is slow. Most of that is the ML
models: Demucs for vocal isolation (166 MB) and the English acoustic model
(339 MB). In exchange English needs no download, and `/healthz` reports
`modelsReady: true` right after `docker compose up`.

A language that fails to download does not stop the container. The server starts
with the models it holds, and the app marks the rest as not installed. The
entrypoint tries again on the next start.

The ONNX exports are produced once with `packages/align/scripts/export-asr-onnx.py`
(see `packages/align/README.md`). `MUSICBUTLER_ASR_EN` and `MUSICBUTLER_ASR_IT`
override the model id or point at a local export directory.

## How a sync works

1. `ffmpeg` decodes the track.
2. Demucs isolates the vocals (optional, on by default; about three times slower
   but much better on a dense mix).
3. A wav2vec2 CTC model produces per-frame character probabilities.
4. Your lyrics are force-aligned to those frames (CTC forced alignment).
5. The result is written as enhanced LRC: `[mm:ss.xx]` per line and
   `<mm:ss.xx>` per word. Word tags can be turned off in the confirm dialog.

A 4-minute song takes about 70 s on an Apple M-series CPU. Numbers in the
lyrics cannot be aligned (the models have no digits): write them out as words.

The alignment runs on a worker thread, so the app stays usable while a job
runs. You can edit a different song, start more jobs or move around the library.
A job blocks only the song it aligns.

## The sync queue

Start a sync and the job joins a queue. The server runs one job at a time,
because the models take all of the processor. The **Sync queue** screen lists
the job that runs, the jobs that wait and the jobs that finished. Each row shows
the stage, the percentage and the run time. You can cancel a job that runs and a
job that still waits. The sidebar shows a count while jobs are active.

Two jobs on one song are refused. They would write the same `.lrc` file at the
same time.

## Import lyrics

Select **Import lyrics** to get the words from an outside source. The app asks
three sources at once.

| Source | Access | Timestamps |
| --- | --- | --- |
| [LRCLIB](https://lrclib.net/docs) | Open API. No key. | Yes |
| [Genius](https://genius.com) | The app reads the song page. | No |
| [AZLyrics](https://www.azlyrics.com) | The app reads the song page. | No |

LRCLIB comes first, because it is the only source with an API and the only one
that holds timestamps. A result marked **Timed** goes into the editor with its
timestamps, so you can skip the sync step. The other two sources hold words
only, so those results still need a sync.

Genius and AZLyrics have no lyrics API. The app reads their pages instead, so
those two stop working whenever the site changes. A source that fails is
reported next to the results that did arrive. AZLyrics blocks automated readers
and often refuses a server, so expect it to fail more than the others.

An import goes into the editor and not to disk. Save it yourself. The search
fields come from the file path, because the server reads no tags from the audio
file. Correct them when the guess is wrong, then search again.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MUSIC_DIR` | `/music` | The library root inside the container. Required. |
| `MUSICBUTLER_LANGS` | `en-US` | Languages to run, comma separated. Anything past English downloads on the first start. |
| `MODEL_CACHE_DIR` | `/models` | Where the models live. The image ships English here. Mount a volume to keep a download. |
| `PORT` | `3000` | HTTP port. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary. |
| `PUID` / `PGID` | `1000` | uid/gid the server runs as, so written files belong to the library owner. |
| `MUSICBUTLER_ASR_EN` / `MUSICBUTLER_ASR_IT` | the `linandrea/…-onnx` ids | ASR model id or absolute path of an exported directory; empty disables the language. |

`.env.example` lists the values the compose file reads:
`NAVIDROME_MUSIC_DIR`, `PUID`, `PGID` and `MUSICBUTLER_LANGS`.

## Development

Requirements: [Bun](https://bun.sh) 1.3, `ffmpeg` on PATH.

```bash
bun install
bun pm trust --all        # lets onnxruntime-node run its postinstall
bun run dev               # Vite on :5173 + server on :3000 against fixtures/library
bun run typecheck && bun run lint && bun test
```

The alignment engine has its own README and CLI in `packages/align`. Pull the
models once with `bun run scripts/fetch-models.ts` (they land in
`~/.cache/musicbutler`). End-to-end engine tests run with
`MUSICBUTLER_E2E=1 bun test packages/align/test/e2e.test.ts`.

Build the image locally against a copied fixture library:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Repository layout, decisions and the full plan live in `docs/`.

## License

musicbutler is free software. It is licensed under the GNU Affero General
Public License, version 3. `LICENSE` holds the full text.

Section 13 covers use over a network. If you change musicbutler and let other
people reach your copy, you must offer them the source of that copy. The source
of this copy is at <https://github.com/andreazllin/musicbutler>.
