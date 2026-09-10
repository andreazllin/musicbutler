#!/bin/sh
# Runs the server as the `app` user with the uid/gid from PUID/PGID, so the
# .lrc files it writes belong to the owner of the music library (docs/PLAN.md §9.3).
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
	if [ "$(id -g app)" != "$PGID" ]; then groupmod -o -g "$PGID" app; fi
	if [ "$(id -u app)" != "$PUID" ]; then usermod -o -u "$PUID" app; fi
	# The models are read-only and owned by root; only the cache for transformers
	# metadata needs to be readable, which 0755 already gives.
	chown -R app:app /app/.cache 2>/dev/null || true
	exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups "$@"
fi
exec "$@"
