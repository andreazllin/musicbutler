# Release runbook

musicbutler ships as one public container image on the GitHub Container
Registry (docs/PLAN.md §9). This is the checklist for every release, plus the
one-time steps that make the image pullable without a login.

## One-time setup

1. **Push the repository to GitHub.** `release.yml` uses
   `${{ github.repository_owner }}`, so the image name follows the owner
   automatically: `ghcr.io/andreazllin/musicbutler`.
2. **Let the first workflow run.** A push to `main` builds and pushes
   `ghcr.io/andreazllin/musicbutler:latest` (and `:sha-…`).
3. **Flip the package to Public.** GHCR makes a package *private* on its first
   push, and a private package returns `401` to everyone else. Go to
   `https://github.com/andreazllin?tab=packages` → `musicbutler` → *Package
   settings* → *Danger Zone* → *Change visibility* → **Public**. Do this once
   per package (`musicbutler` only; both tags live in the same package).
4. **Verify anonymously** from any machine:

   ```bash
   docker logout ghcr.io
   docker pull ghcr.io/andreazllin/musicbutler:latest
   docker buildx imagetools inspect ghcr.io/andreazllin/musicbutler:latest
   ```

   The last command must list **both** `linux/amd64` and `linux/arm64`.
5. **Owner is `andreazllin`.** The root `docker-compose.yml` and `README.md`
   already reference `ghcr.io/andreazllin/musicbutler`.

## Every release

1. Make sure `main` is green (`CI` workflow).
2. Tag and push:

   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

   `release.yml` publishes `1.2.3`, `1.2`, `1`, `sha-<commit>`, and refreshes
   `latest` when the tag is on the default branch.
3. Wait for the workflow. The arm64 half runs under QEMU and is slow (expect
   20–40 minutes for the ONNX dependencies). The model layer is cached between
   builds, so a code-only release does not re-download the weights.
4. Smoke test the quickstart in an empty directory (docs/PLAN.md §9.1):

   ```bash
   mkdir mb-smoke && cd mb-smoke
   curl -O https://raw.githubusercontent.com/andreazllin/musicbutler/main/docker-compose.yml
   echo 'NAVIDROME_MUSIC_DIR=/path/to/a/COPY/of/your/music' > .env
   docker compose up -d
   curl -s localhost:3000/healthz   # {"ok":true,"musicDirWritable":true,"modelsReady":true}
   ```

5. Write the release notes on GitHub. Mention the image size, and any change to
   the environment variables or to the compose file.

## How the image is built

`release.yml` builds each architecture on a native runner (`ubuntu-latest` for
amd64, `ubuntu-24.04-arm` for arm64), pushes both by digest, and joins them
into one manifest list per tag in the `merge` job. No QEMU is involved: the
first full build took about 8 minutes per architecture, and cached rebuilds
about 3. One manifest list is published per run (`latest`, semver tags,
`sha-…`). There is no separate multilang image: English is baked in, and
`MUSICBUTLER_LANGS` tells the entrypoint to download the rest.

Verified on 2026-09-10 (first release from `main`): `docker buildx imagetools
inspect ghcr.io/andreazllin/musicbutler:latest` lists `linux/amd64` and
`linux/arm64` (plus two `unknown/unknown` provenance attestations, which is
normal), and the quickstart above works after `docker logout ghcr.io`.
