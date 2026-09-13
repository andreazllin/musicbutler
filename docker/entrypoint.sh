#!/bin/sh
# Prepares the container, then runs the server as the `app` user with the
# uid/gid from PUID/PGID, so the .lrc files it writes belong to the owner of the
# music library (docs/PLAN.md §9.3).
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
MODEL_CACHE_DIR="${MODEL_CACHE_DIR:-/models}"
# The image bakes en-US. Name more languages here to add them; each one is
# downloaded once into the models volume (docs/PLAN.md §13.16).
MUSICBUTLER_LANGS="${MUSICBUTLER_LANGS:-en-US}"

fetch_models() {
	# Already-present languages cost one check and no download, so this is cheap
	# on every start after the first.
	set +e
	bun run scripts/fetch-models.ts --dir "$MODEL_CACHE_DIR" --lang "$MUSICBUTLER_LANGS"
	status=$?
	set -e

	if [ "$status" = "2" ]; then
		echo "entrypoint: MUSICBUTLER_LANGS is not valid. Correct it and start again." >&2
		exit 2
	fi
	if [ "$status" != "0" ]; then
		# A download can fail because the network is down or Hugging Face is
		# unreachable. The server still starts: every language it already holds
		# works, and the app marks the others as not installed.
		echo "entrypoint: a model download failed. The app starts with the models it has." >&2
	fi
}

if [ "$(id -u)" = "0" ]; then
	if [ "$(id -g app)" != "$PGID" ]; then groupmod -o -g "$PGID" app; fi
	if [ "$(id -u app)" != "$PUID" ]; then usermod -o -u "$PUID" app; fi
	fetch_models
	# The download runs as root, so hand the cache to the user that reads it.
	chown -R "$PUID:$PGID" "$MODEL_CACHE_DIR" 2>/dev/null || true
	chown -R app:app /app/.cache 2>/dev/null || true
	exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups "$@"
fi

fetch_models
exec "$@"
