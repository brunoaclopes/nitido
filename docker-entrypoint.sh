#!/bin/sh
# Runs the server as an unprivileged user that owns /data. PUID and PGID choose it (to match the owner
# of the folder on a NAS); by default it is the image's "node" user (1000:1000).
set -e
PUID=${PUID:-1000}
PGID=${PGID:-1000}
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/profiles /data/sessions
  chown -R "$PUID:$PGID" /data 2>/dev/null || true
  exec su-exec "$PUID:$PGID" node server.mjs
fi
exec node server.mjs
