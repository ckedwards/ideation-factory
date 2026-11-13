#!/bin/bash
# The load test from a machine of its own, against a deployment through its load balancer (AWS.md
# says how to set one up). Settings are in .data/remote.env (remote.env.example):
#
#   remote.sh up        start Mailpit, which the deployment's SMTP points at
#   remote.sh seed      seed the design scale's data (resumable)
#   remote.sh steady    page views at LOAD_RATE a second for LOAD_DURATION
#   remote.sh burst     the same, with LOAD_BOTS bots (50 unless set) commenting and editing
#   remote.sh down      stop Mailpit
#
# Each run's CPU and memory are sampled every 5 s on each node over SSH (NODES), and its results
# are in .data/results, as run.sh's are.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DATA=$HERE/.data
ENV_FILE=$DATA/remote.env
if [ ! -f "$ENV_FILE" ]; then
  echo "copy remote.env.example to .data/remote.env and fill it in" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export LOAD_USER="$(id -u):$(id -g)"
# the seeder and the token minter: through the load balancer, as people's browsers are
export LOAD_APP_URL=${LOAD_APP_URL:-$LOAD_URLS}
export LOAD_MAILPIT_URL=${LOAD_MAILPIT_URL:-http://127.0.0.1:8025}
if [ "${LOAD_INSECURE_TLS:-0}" = 1 ]; then
  export NODE_TLS_REJECT_UNAUTHORIZED=0
fi
mkdir -p "$DATA/results"

dc() {
  docker compose -f "$HERE/remote.yaml" --env-file "$ENV_FILE" "$@"
}

# CPU and memory of every container on every node, every 5 s, until stopped (their PIDs in SAMPLERS)
SAMPLERS=()
sample() {
  local out=$1
  for node in $NODES; do
    (while true; do
      ssh -o BatchMode=yes -o ConnectTimeout=5 "${SSH_USER:+$SSH_USER@}$node" \
        "docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}'" 2>/dev/null \
        | sed "s/^/$(date +%T),$node:/" || true
      sleep 5
    done) >> "$out" &
    SAMPLERS+=($!)
  done
}

load() {
  local name=$1
  shift
  local out
  out="$DATA/results/$name-$(date +%Y%m%d-%H%M%S)"
  sample "$out-stats.csv"
  # people's tokens as at steady state: got before the run, renewed during it at the real rate
  if [ "${LOAD_AUTH:-jwt}" = jwt ]; then
    bun "$HERE/src/tokens.ts"
  fi
  dc --profile k6 run --rm "$@" k6 run --summary-export "/data/results/$(basename "$out").json" /load/k6/load.ts \
    | tee "$out.txt" || true
  kill "${SAMPLERS[@]}" 2>/dev/null || true
  echo "results: $out.txt, $out.json, $out-stats.csv"
}

case "${1:-}" in
  up)
    dc up -d mailpit
    ;;
  seed)
    bun "$HERE/src/seed.ts"
    ;;
  steady)
    load steady -e LOAD_RATE="${LOAD_RATE:-167}" -e LOAD_DURATION="${LOAD_DURATION:-10m}" \
      -e LOAD_AUTH="${LOAD_AUTH:-jwt}" -e LOAD_VUS="${LOAD_VUS:-300}"
    ;;
  burst)
    load burst -e LOAD_RATE="${LOAD_RATE:-167}" -e LOAD_DURATION="${LOAD_DURATION:-10m}" \
      -e LOAD_AUTH="${LOAD_AUTH:-jwt}" -e LOAD_VUS="${LOAD_VUS:-300}" -e LOAD_BOTS="${LOAD_BOTS:-50}"
    ;;
  down)
    dc down
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 2
    ;;
esac
