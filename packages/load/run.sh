#!/bin/bash
# The load test on the one-VM Compose, on this machine (see README.md):
#
#   run.sh up        start it, with Mailpit and the app reachable by the seeder
#   run.sh seed      seed the design scale's data (resumable)
#   run.sh steady    page views at LOAD_RATE a second for LOAD_DURATION
#   run.sh burst     the same, with LOAD_BOTS bots (50 unless set) commenting and editing
#   run.sh down      stop it, keeping its data
#   run.sh wipe      stop it and delete its data and the seed
#
# LOAD_RIVETKIT_FIX=1 runs the app on RivetKit with the fix for rivet-dev/rivet#5991 (rivetkit-fix/build.sh).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DATA=$HERE/.data
ENV_FILE=$DATA/load.env
export LOAD_USER="$(id -u):$(id -g)"

# LOAD_RIVETKIT_FIX=1: the app on RivetKit's native module with the fix for rivet-dev/rivet#5991 (rivetkit-fix/)
FIX=()
if [ "${LOAD_RIVETKIT_FIX:-0}" = 1 ]; then
  if [ ! -f "$DATA/rivetkit-napi-fixed.node" ]; then
    echo "build it first: packages/load/rivetkit-fix/build.sh" >&2
    exit 1
  fi
  FIX=(-f "$HERE/rivetkit-fix/compose.yaml")
  export LOAD_RIVETKIT_VERSION
  LOAD_RIVETKIT_VERSION=$(grep -oE '"rivetkit": "[^"]+"' "$ROOT/packages/server/package.json" | grep -oE '[0-9][^"]*')
fi

dc() {
  docker compose -p ideaf-load -f "$ROOT/deploy/one-vm/compose.yaml" -f "$HERE/compose.yaml" "${FIX[@]}" --env-file "$ENV_FILE" "$@"
}

settings() {
  mkdir -p "$DATA/results"
  if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" <<SETTINGS
IDEAF_HOST=localhost
IDEAF_URL=https://localhost:18443
HTTP_PORT=18090
HTTPS_PORT=18443
TLS_MODE=internal
IDEAF_AUTH_SECRET=$(openssl rand -hex 32)
RIVET_ADMIN_TOKEN=$(openssl rand -hex 32)
IDEAF_SITE_ADMINS=admin@load.test
COMPOSE_PROFILES=seaweedfs
S3_ENGINE_ACCESS_KEY_ID=engine
S3_ENGINE_SECRET_ACCESS_KEY=$(openssl rand -hex 16)
S3_FILES_ACCESS_KEY_ID=files
S3_FILES_SECRET_ACCESS_KEY=$(openssl rand -hex 16)
SETTINGS
  fi
}

wait_healthy() {
  for _ in $(seq 1 120); do
    if curl -sf -m 3 http://localhost:18080/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "the app didn't become healthy" >&2
  return 1
}

# k6, with CPU and memory sampled every 5 s and the app's and engine's warnings counted afterwards
load() {
  local name=$1
  shift
  local stamp
  stamp=$(date +%Y%m%d-%H%M%S)
  [ "${LOAD_RIVETKIT_FIX:-0}" = 1 ] && name="$name-fixed"
  local out="$DATA/results/$name-$stamp"
  local since
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  (while true; do
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' | sed "s/^/$(date +%T),/"
    sleep 5
  done) > "$out-stats.csv" &
  local sampler=$!
  # people's tokens as at steady state: got before the run, renewed during it at the real rate
  if [ "${LOAD_AUTH:-jwt}" = jwt ]; then
    bun "$HERE/src/tokens.ts"
  fi
  dc run --rm "$@" k6 run --summary-export "/data/results/$name-$stamp.json" /load/k6/load.ts | tee "$out.txt" || true
  kill "$sampler"
  {
    echo "== warnings from $since"
    for service in app engine; do
      local logs
      logs=$(dc logs --no-color --since "$since" "$service" 2>&1)
      for pattern in 'storage is overloaded' 'reading the queue failed' 'reading the write queue failed' \
        'updating the index failed' 'flushing the outbox failed' 'notifying failed' 'sending an email failed' \
        'gateway retry budget is spent' 'Too many requests'; do
        printf '%s\t%s\t%s\n' "$service" "$(grep -c "$pattern" <<<"$logs" || true)" "$pattern"
      done
    done
  } | tee "$out-warnings.txt"
  echo "results: $out.txt, $out.json, $out-stats.csv, $out-warnings.txt"
}

case "${1:-}" in
  up)
    settings
    dc up -d --build
    wait_healthy
    ;;
  seed)
    settings
    bun "$HERE/src/seed.ts"
    ;;
  steady)
    settings
    load steady -e LOAD_RATE="${LOAD_RATE:-167}" -e LOAD_DURATION="${LOAD_DURATION:-10m}" -e LOAD_AUTH="${LOAD_AUTH:-jwt}" -e LOAD_VUS="${LOAD_VUS:-300}" -e LOAD_URLS="${LOAD_URLS:-}"
    ;;
  burst)
    settings
    load burst -e LOAD_RATE="${LOAD_RATE:-167}" -e LOAD_DURATION="${LOAD_DURATION:-10m}" -e LOAD_AUTH="${LOAD_AUTH:-jwt}" -e LOAD_VUS="${LOAD_VUS:-300}" -e LOAD_URLS="${LOAD_URLS:-}" -e LOAD_BOTS="${LOAD_BOTS:-50}"
    ;;
  down)
    settings
    dc down
    ;;
  wipe)
    settings
    dc down -v
    rm -f "$DATA/seed.json"
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 2
    ;;
esac
