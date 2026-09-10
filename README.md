# musicbutler

A self-hosted web tool that maintains a [Navidrome](https://www.navidrome.org/)
music library. v1 ships one tool, **Lyrics Sync**: browse the library, write or
edit the `.lrc` file of a song, generate word-level timestamps by aligning the
lyrics against the audio, and check the result by listening.

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
    image: ghcr.io/andreazllin/musicbutler:latest   # pin a version for stability, e.g. :0.0.1
    environment:
      MUSIC_DIR: /music
      PORT: "3000"
      PUID: "${PUID:-1000}"   # must match the owner of your music library
      PGID: "${PGID:-1000}"
    volumes:
      - ${NAVIDROME_MUSIC_DIR:?set NAVIDROME_MUSIC_DIR in .env}:/music   # read-write on purpose
    ports:
      - "127.0.0.1:3000:3000"   # never 0.0.0.0 without the auth proxy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
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

## Image size and languages

The image is large (about **1.7 GB** with the English model) and the first pull
is slow. The size is the bundled ML models: Demucs for vocal isolation (166 MB)
and a wav2vec2 acoustic model per language. In exchange the container works at
once, offline, with no runtime download, and `/healthz` reports
`modelsReady: true` right after `docker compose up`.

| Language | Acoustic model (ONNX, int8) | Source model | Size |
| --- | --- | --- | --- |
| `en-US` English | `linandrea/wav2vec2-large-960h-lv60-self-onnx` | `facebook/wav2vec2-large-960h-lv60-self` | 339 MB |
| `it-IT` Italian | `linandrea/wav2vec2-large-xlsr-53-italian-onnx` | `jonatasgrosman/wav2vec2-large-xlsr-53-italian` | 355 MB |

| Tag | Languages | Approximate size |
| --- | --- | --- |
| `latest`, `1.x` | English | ~1.7 GB |
| `latest-multilang` | English + Italian | ~2.1 GB |

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

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MUSIC_DIR` | `/music` | The library root inside the container. Required. |
| `MODEL_CACHE_DIR` | `/models` | Where the models live. The image ships them here; override to mount your own. |
| `PORT` | `3000` | HTTP port. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary. |
| `PUID` / `PGID` | `1000` | uid/gid the server runs as, so written files belong to the library owner. |
| `MUSICBUTLER_ASR_EN` / `MUSICBUTLER_ASR_IT` | the `linandrea/…-onnx` ids | ASR model id or absolute path of an exported directory; empty disables the language. |

`.env.example` lists the only values the compose file needs:
`NAVIDROME_MUSIC_DIR`, `PUID`, `PGID`.

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
