# HANDOFF (2026-09-10)

State of the musicbutler build for whoever resumes (human or agent). Plan:
`docs/PLAN.md`; decisions: `docs/DECISIONS.md`; release runbook: `docs/RELEASE.md`.

## Done and committed (all milestones M1–M9 built; verification notes below)
- M1 scaffold · M2 `packages/lrc` (73 tests) · M3/M4 `apps/server` (83 tests).
- M5/M6 `apps/web`: shell, theme, TanStack Router, tRPC + TanStack Query, nuqs
  (`?song=`), file tree on React Aria `Tree`, CodeMirror LRC mode + linter,
  save/delete/conflict/dirty-guard flows. Verified in the browser.
- M7 `packages/align` (engine, 226 tests incl. skipped e2e) + server `sync.*`
  wiring (`apps/server/src/sync/engine.ts`). Verified: a real sync from the
  browser, the §7.5 button table, mid-run cancel leaves the file untouched.
- M8 sync checker: rAF highlight, click-to-seek, offset + apply, single-step undo.
- M9: `Dockerfile` (models baked, 1.4 GB arm64 image), compose files, CI,
  release workflow, README, RELEASE.md. Verified: `docker build`, container
  with `--network none` reports `modelsReady: true`, runs as PUID/PGID, serves
  the UI, completes a sync through tRPC. `docker-compose.dev.yml` probed too.

## Not verified / needs the user
- Published 2026-09-10: repo <https://github.com/andreazllin/musicbutler> (public),
  images `ghcr.io/andreazllin/musicbutler:{latest,sha-…}`, both
  `linux/amd64` and `linux/arm64`, built on native runners (no QEMU). The
  quickstart in README works anonymously after `docker logout ghcr.io`.
- ASR models (user decision 2026-09-10): en-US `facebook/wav2vec2-large-960h-lv60-self`,
  it-IT `jonatasgrosman/wav2vec2-large-xlsr-53-italian`, exported to ONNX with
  `packages/align/scripts/export-asr-onnx.py` into `~/.cache/musicbutler/export/out/`
  and symlinked into `~/.cache/musicbutler/transformers/andreazllin/…`. Both e2e
  tests pass (en 0.93, it 0.86 mean word score). Published on Hugging Face as
  `linandrea/wav2vec2-large-960h-lv60-self-onnx` and
  `linandrea/wav2vec2-large-xlsr-53-italian-onnx`; a fresh
  `bun run scripts/fetch-models.ts --lang en-US,it-IT` downloads 866 MB in total.
- Toasts use `@mantine/notifications`, wrapped by `apps/web/src/lib/notify.ts`.

## Environment notes
- Bun 1.3.14, isolated linker (`node_modules/.bun`). TypeScript pinned 5.9.3.
- Commit signing is disabled repo-locally (`git config commit.gpgsign false`)
  because 1Password SSH signing cannot run non-interactively.
- `bun run dev` → server :3000 (MODEL_CACHE_DIR defaults to
  `~/.cache/musicbutler`, which holds the English models), Vite :5173.
- Engine e2e: `MUSICBUTLER_E2E=1 bun test packages/align/test/e2e.test.ts`
  (needs `bun run packages/align/scripts/make-fixture.ts` once for the wav).
- Docker is OrbStack; start with `open -a OrbStack`.
