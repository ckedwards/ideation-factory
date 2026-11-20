#!/bin/bash
# Development only: the app as people try it, the try-it Compose (deploy/compose), but from this
# checkout's own builds of the app and the engine, to try a change in the browser before it's
# released. It's a project of its own (ideaf-test-ui) on ports of its own, beside a real try-it
# Compose or the dev server; its settings and data stay until wipe.
#
#   scripts/test-ui.sh up              build this checkout and start it (again after changing the code)
#   scripts/test-ui.sh seed            fill it with sample people, teams and ideas (scripts/test-ui-data.ts), once;
#                                      seed medium adds a generated company of about 150 people (scripts/test-ui-medium.ts)
#   scripts/test-ui.sh save [name]     keep a copy of its data as it is now, as name (seeded if none)
#   scripts/test-ui.sh restore name    put that copy back, in place of whatever's there now (after a wipe too);
#                                      without a name, the saves there are to restore
#   scripts/test-ui.sh saves           list the copies kept
#   scripts/test-ui.sh down            stop it, keeping its data
#   scripts/test-ui.sh wipe            stop it and delete its data, and its settings; saves are kept
#   scripts/test-ui.sh logs            follow the app's log
#
# The site is at http://localhost:28080 (TEST_UI_PORT), and the email it sends, sign-in codes
# included, at http://localhost:28025 (TEST_UI_MAILPIT_PORT): sign in as admin@example.com, the
# site admin, or any other address.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
DATA=$ROOT/.data/test-ui
ENV_FILE=$DATA/compose.env
# saves are kept beside its data, not in it, so a wipe keeps them
SAVES=$ROOT/.data/test-ui-saves
PORT=${TEST_UI_PORT:-28080}
MAILPIT=${TEST_UI_MAILPIT_PORT:-28025}

dc() {
  COMPOSE_FILE= docker compose -p ideaf-test-ui --project-directory "$ROOT" --env-file "$ENV_FILE" \
    -f "$ROOT/deploy/compose/compose.yaml" -f "$ROOT/scripts/test-ui.yaml" "$@"
}

# waits for the app to answer, and says where it is
healthy() {
  for _ in $(seq 1 90); do
    if curl -sf -m 3 "http://localhost:$PORT/health" >/dev/null; then
      echo "up: http://localhost:$PORT (sign in as admin@example.com), email at http://localhost:$MAILPIT"
      return 0
    fi
    sleep 2
  done
  echo "the app didn't become healthy: scripts/test-ui.sh logs" >&2
  return 1
}

# a save's folder, by its name (seeded if none)
save_dir() {
  local name=${1:-seeded}
  if [[ ! $name =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "a save's name is letters, digits, dots, dashes and underscores: $name" >&2
    exit 2
  fi
  echo "$SAVES/$name"
}

# whether there are any saves
any_saves() {
  [ -d "$SAVES" ] && [ -n "$(ls -A "$SAVES")" ]
}

# the saves, newest first: name, when, size
list_saves() {
  if ! any_saves; then
    echo "no saves yet: scripts/test-ui.sh save [name]"
    return
  fi
  for dir in $(ls -td "$SAVES"/*/); do
    printf '  %-24s %s  %s\n' "$(basename "$dir")" "$(date -r "$dir/engine.tgz" '+%Y-%m-%d %H:%M')" "$(du -sh "$dir" | cut -f1)"
  done
}

# runs a shell in a one-off container of the app's image, as root, with both volumes (the engine's
# storage at /engine, the ideas' files at /data) and a save's folder at /save; the stack is stopped
with_volumes() {
  dc run --rm --no-deps --user root --entrypoint sh -v ideaf-test-ui_engine:/engine -v "$1":/save app -c "$2"
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
    healthy
    ;;
  seed)
    TEST_UI_URL="http://localhost:$PORT" TEST_UI_MAILPIT_URL="http://localhost:$MAILPIT" \
      bun "$ROOT/scripts/test-ui-seed.ts" "${@:2}"
    ;;
  save)
    dir=$(save_dir "${2:-}")
    settings
    if [ -z "$(dc ps -q engine)" ]; then
      echo "nothing to save: scripts/test-ui.sh up (and seed) first" >&2
      exit 1
    fi
    mkdir -p "$dir"
    # stopped, so the engine's storage is copied as it last wrote it
    dc stop app engine
    with_volumes "$dir" 'tar -czf /save/engine.tgz -C /engine . && tar -czf /save/files.tgz -C /data .'
    # its secrets too: sign-in's keys are kept encrypted with them
    (umask 077 && cp "$ENV_FILE" "$dir/compose.env")
    dc start engine app
    healthy
    echo "saved as $(basename "$dir") ($(du -sh "$dir" | cut -f1)): scripts/test-ui.sh restore $(basename "$dir")"
    ;;
  restore)
    # which one: with no name, or one there's no save of, what there is to restore
    if ! any_saves; then
      echo "nothing to restore: no saves yet (scripts/test-ui.sh save [name])" >&2
      exit 1
    fi
    if [ -z "${2:-}" ]; then
      echo "restore which? scripts/test-ui.sh restore <name>, one of:"
      list_saves
      exit 2
    fi
    dir=$(save_dir "$2")
    if [ ! -f "$dir/engine.tgz" ]; then
      echo "no save called $2; there's:" >&2
      list_saves >&2
      exit 1
    fi
    # the save's secrets, with the ports as they're set now
    mkdir -p "$DATA"
    (umask 077 && cp "$dir/compose.env" "$ENV_FILE")
    settings
    # made, if it was wiped (built as up builds it), and stopped
    dc up --no-start --build --remove-orphans
    dc stop
    with_volumes "$dir" 'find /engine /data -mindepth 1 -delete && tar -xzf /save/engine.tgz -C /engine && tar -xzf /save/files.tgz -C /data'
    dc up -d
    healthy
    echo "restored $(basename "$dir")"
    ;;
  saves)
    list_saves
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
    sed -n '2,20p' "$0"
    exit 2
    ;;
esac
