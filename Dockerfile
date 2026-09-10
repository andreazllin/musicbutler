# syntax=docker/dockerfile:1.7
# musicbutler: one image with the server, the built web app, ffmpeg and the ML
# models baked in (docs/PLAN.md §9.2). Multi-arch: linux/amd64 and linux/arm64.
ARG BUN_VERSION=1.3.14
# Set to 1 to also bake the Italian ASR model (docs/PLAN.md §13.16).
ARG WITH_IT_MODEL=0

# ---------------------------------------------------------------------------
# 1. deps: install every workspace dependency once (cached on lockfile changes).
#    `trustedDependencies` in package.json lets the onnxruntime-node postinstall run.
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/lrc/package.json packages/lrc/
COPY packages/align/package.json packages/align/
# `bun pm trust --all` exits 1 when every script already ran, hence `|| true`.
RUN bun install --frozen-lockfile \
 && (bun pm trust --all || true) \
 && test -d node_modules/.bun/onnxruntime-node@1.24.3/node_modules/onnxruntime-node/bin/napi-v6/linux \
 && echo "onnxruntime-node native binaries present: $(ls node_modules/.bun/onnxruntime-node@1.24.3/node_modules/onnxruntime-node/bin/napi-v6/linux)"

# ---------------------------------------------------------------------------
# 2. models: download the weights into /models as its OWN layer. A code-only
#    change does not invalidate it, so the layer stays cached and is not pushed again.
# ---------------------------------------------------------------------------
FROM deps AS models
ARG WITH_IT_MODEL
COPY packages/shared packages/shared
COPY packages/align packages/align
COPY scripts/fetch-models.ts scripts/fetch-models.ts
RUN if [ "$WITH_IT_MODEL" = "1" ]; then LANGS="en-US,it-IT"; else LANGS="en-US"; fi \
 && bun run scripts/fetch-models.ts --dir /models --lang "$LANGS"

# ---------------------------------------------------------------------------
# 3. build: build the web app and prune to the production dependencies.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN bun run --filter @musicbutler/web build
# Production dependencies only: the web app is already built into apps/web/dist.
RUN rm -rf node_modules apps/web/node_modules packages/*/node_modules apps/server/node_modules \
 && bun install --frozen-lockfile --production --filter @musicbutler/server --filter @musicbutler/align --filter @musicbutler/lrc --filter @musicbutler/shared \
 && (bun pm trust --all || true)

# ---------------------------------------------------------------------------
# 4. runtime: Bun, ffmpeg, wget for the healthcheck, a non-root user, the server
#    source (run by Bun directly), the built frontend and the models.
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg wget util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 # The base image already ships a `bun` user with uid/gid 1000; rename it to `app`.
 && groupmod -n app "$(getent group 1000 | cut -d: -f1)" \
 && usermod -l app -d /home/app -m "$(getent passwd 1000 | cut -d: -f1)"
WORKDIR /app
ENV NODE_ENV=production \
    MUSIC_DIR=/music \
    MODEL_CACHE_DIR=/models \
    PORT=3000 \
    HOME=/app/.cache
COPY --from=build /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/packages ./packages
COPY --from=models /models /models
COPY docker/entrypoint.sh /entrypoint.sh
RUN mkdir -p /app/.cache /music && chown -R app:app /app/.cache /music
VOLUME ["/music"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "apps/server/src/index.ts"]
