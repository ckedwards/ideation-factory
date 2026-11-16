#!/bin/bash
# Development only: the app as people try it, the try-it Compose (deploy/compose), but from this
# checkout's own builds of the app and the engine, to try a change in the browser before it's
# released. It's a project of its own (ideaf-test-ui) on ports of its own, beside a real try-it
# Compose or the dev server; its settings and data stay until wipe.
#
#   scripts/test-ui.sh up      build this checkout and start it (again after changing the code)
#   scripts/test-ui.sh down    stop it, keeping its data
#   scripts/test-ui.sh wipe    stop it and delete its data, and its settings
#   scripts/test-ui.sh logs    follow the app's log
#
# The site is at http://localhost:28080 (TEST_UI_PORT), and the email it sends, sign-in codes
# included, at http://localhost:28025 (TEST_UI_MAILPIT_PORT): sign in as admin@example.com, the
# site admin, or any other address.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
DATA=$ROOT/.data/test-ui
ENV_FILE=$DATA/compose.env
PORT=${TEST_UI_PORT:-28080}
MAILPIT=${TEST_UI_MAILPIT_PORT:-28025}

dc() {
  COMPOSE_FILE= docker compose -p ideaf-test-ui --project-directory "$ROOT" --env-file "$ENV_FILE" \
    -f "$ROOT/deploy/compose/compose.yaml" -f "$ROOT/scripts/test-ui.yaml" "$@"
}

# 32 random bytes, as hex
secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

# its settings, made once: new secrets, and the ports (changing them takes effect on the next up)
settings() {
  mkdir -p "$DATA"
  if [ ! -f "$ENV_FILE" ]; then
    umask 077
    cat > "$ENV_FILE" <<SETTINGS
IDEAF_AUTH_SECRET=$(secret)
RIVET_ADMIN_TOKEN=$(secret)
IDEAF_SITE_ADMINS=admin@example.com
SETTINGS
  fi
  # the ports, as they're set now (grep and a rename, as sed -i differs on macOS)
  grep -vE '^(IDEAF_PORT|IDEAF_URL|MAILPIT_PORT)=' "$ENV_FILE" > "$ENV_FILE.new" || true
  printf 'IDEAF_PORT=%s\nIDEAF_URL=http://localhost:%s\nMAILPIT_PORT=%s\n' "$PORT" "$PORT" "$MAILPIT" >> "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"
}

case "${1:-}" in
  up)
    settings
    dc up -d --build --remove-orphans
    for _ in $(seq 1 90); do
      if curl -sf -m 3 "http://localhost:$PORT/health" >/dev/null; then
        echo "up: http://localhost:$PORT (sign in as admin@example.com), email at http://localhost:$MAILPIT"
        exit 0
      fi
      sleep 2
    done
    echo "the app didn't become healthy: scripts/test-ui.sh logs" >&2
    exit 1
    ;;
  down)
    settings
    dc down
    ;;
  wipe)
    settings
    dc down -v
    rm -rf "$DATA"
    ;;
  logs)
    settings
    dc logs -f app
    ;;
  *)
    sed -n '2,15p' "$0"
    exit 2
    ;;
esac
