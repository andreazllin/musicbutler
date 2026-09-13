# AGENTS.md

Conventions for anyone, human or agent, who commits to this repository.

## Commit messages

Every commit uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
Every commit in the history already follows it, so there are no exceptions
to copy from.

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

| Type | Use it for |
| --- | --- |
| `feat` | A new capability for the user. |
| `fix` | A correction of wrong behavior. |
| `docs` | Documentation only: `README.md`, `docs/`, `HANDOFF.md`, `AGENTS.md`. |
| `refactor` | A change that keeps the behavior and the public API. |
| `perf` | A change made to go faster or use less memory. |
| `test` | Tests and fixtures only. |
| `build` | The Docker image, the compose files, dependencies, the build scripts. |
| `ci` | The workflows in `.github/workflows/`. |
| `chore` | Everything else: tooling config, scaffolding, version bumps. |

### Scope

The scope is the part of the repository that changed. Leave it out when the
change touches the repository as a whole.

| Scope | Path |
| --- | --- |
| `server` | `apps/server/` |
| `web` | `apps/web/` |
| `align` | `packages/align/` |
| `lrc` | `packages/lrc/` |
| `shared` | `packages/shared/` |
| `scripts` | `scripts/` |
| `docker` | `Dockerfile`, `docker/`, the compose files |
| `release` | Version bumps and the release runbook |

When a change touches more than one scope, give it the scope of the part that
the change is about, and write the rest in the body. If there is no such part,
leave the scope out.

### Subject

- Use the imperative: "add", "fix", "remove". Not "added", not "adds".
- Start with a lower-case letter. Do not end with a period.
- Keep it at 72 characters or less.
- Say what the commit does, not which milestone or plan item it belongs to.

### Body

Add a body when the subject is not enough. Wrap it at 72 characters. Say why
the change was made and what else moved with it. Put judgement calls in
`docs/DECISIONS.md` instead, one line each.

### Breaking changes

Put a `!` after the type and scope, and start the footer with
`BREAKING CHANGE:`.

```
feat(server)!: return relative paths from library.list

BREAKING CHANGE: clients that join the returned path onto MUSIC_DIR must
stop doing so.
```

### Examples from this repository

```
feat(align): add the alignment engine and wire it into server sync
fix(web): give the volume slider a width and guard the slider values
ci: build images natively per arch and merge them into multi-arch manifests
docs: document MUSICBUTLER_ASR_EN and MUSICBUTLER_ASR_IT
chore(release): v0.0.2
```

## Before you commit

Run the checks from the repository root. All three must pass.

```bash
bun run lint        # biome check .
bun run typecheck   # every workspace
bun test
```

`bun run lint:fix` writes the formatting fixes. Biome owns the formatting:
tabs, 100 columns, double quotes, semicolons.

## Repository layout

```
apps/server      Bun HTTP server, tRPC routers, filesystem access, job registry
apps/web         React 19 + Vite + Mantine UI, the Lyrics Sync screen
packages/align   Forced alignment: Demucs, wav2vec2 ASR, CTC trellis
packages/lrc     LRC parse, serialize, validate
packages/shared  Types shared by the server and the web app
scripts          Development runner, model fetcher
docs             PLAN.md, DECISIONS.md, RELEASE.md
fixtures         A small library used by the tests and by bun run dev
```

## Other conventions

- Files are named in kebab-case.
- User-facing text follows ASD-STE100 Simplified Technical English. Use the
  active voice and one instruction per sentence. Keep an instruction under 20
  words and a description under 25. No semicolons, no contractions, no em
  dashes, and no `-ing` verb where a simple tense works. Call one thing by one
  name.
- The UI is [Mantine](https://mantine.dev) (see `docs/PLAN.md` §4.1). Style with
  Mantine components and style props; use a CSS module only for what props
  cannot say. Icons come from `@tabler/icons-react`. Never hard-code a color:
  read a `--mantine-*` variable so both color schemes follow.
- Only `apps/server/src/fs/` reads and writes the music library. A unit test
  enforces it.
- Append one line to `docs/DECISIONS.md` for every judgement call, in the
  format `<date> | <decision> | <why>`.
- Do not rewrite a branch that other people have pulled.
