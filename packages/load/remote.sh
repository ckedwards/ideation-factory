#!/bin/bash
# The load test from a machine of its own, against a deployment through its load balancer (DEPLOYMENT.md
# says how to set one up). Settings are in .data/remote.env (remote.env.example):
#
#   remote.sh up        start Mailpit, which the deployment's SMTP points at
#   remote.sh seed      seed the design scale's data (resumable)
#   remote.sh steady    page views at LOAD_RATE a second for LOAD_DURATION
#   remote.sh burst     the same, with LOAD_BOTS bots (50 unless set) commenting and editing
#   remote.sh steps     a warm-up, then page views rising in steps until the deployment can't keep up
#   remote.sh check     open every seeded idea once, and list any that don't open
#   remote.sh probe     twice a second, a directory read and an idea's page, until Ctrl-C: when each failed
#   remote.sh logs [SINCE]  every node's app, directory and engine logs since SINCE (6h, or a UTC time)
#   remote.sh down      stop Mailpit
#
# steps: LOAD_WARMUP_RATE page views a second (30) for LOAD_WARMUP (5m), then each rate in
# LOAD_STEPS ("40 60 80 100 120 140 160 180 200") for LOAD_STEP (90s), stopping after the first
# step with more than 1% of requests failed or a p95 over LOAD_STOP_P95_MS (1000). Each step is a
# run of its own, with its summary; steps.tsv in its folder has a line for each.
#
# Each run's CPU and memory are sampled every 5 s on each node over SSH (NODES) and on this machine,
# and its results are in .data/results, as run.sh's are. Each steps run also keeps meta.txt (the
# settings, and what each node ran) and, at its end, every node's logs since it began.
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
# the name in the deployment's URL, which k6's container resolves to LOAD_LB_ADDRESS (remote.yaml)
LOAD_HOST=${LOAD_URLS%%,*}
LOAD_HOST=${LOAD_HOST#*://}
export LOAD_HOST=${LOAD_HOST%%[/:]*}
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
  # this machine as well (k6, Mailpit): if k6 runs out of CPU, the results understate the deployment
  (while true; do
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' 2>/dev/null \
      | sed "s/^/$(date +%T),load:/" || true
    echo "$(date +%T),load:host,$(vmstat 1 2 | awk 'END { printf "%d%%", 100 - $15 }'),$(free -m | awk '/^Mem/ { printf "%dMiB / %dMiB", $3, $2 }')"
    sleep 4
  done) >> "$out" &
  SAMPLERS+=($!)
}

# every node's app, directory and engine logs since $2 (an RFC 3339 time, or like 2h), into folder $1
logs() {
  local folder=$1 since=$2 node service
  mkdir -p "$folder"
  for node in $NODES; do
    for service in app directory engine; do
      ssh -o BatchMode=yes -o ConnectTimeout=5 "${SSH_USER:+$SSH_USER@}$node" \
        "docker logs --since '$since' ideaf-$service-1 2>&1 | gzip -c" > "$folder/$node-$service.log.gz" 2>/dev/null \
        || rm -f "$folder/$node-$service.log.gz"
    done
  done
  echo "logs since $since: $folder"
}

# what a run measured: the settings, this checkout, and what each node ran
meta() {
  {
    echo "started: $(date -u +%FT%TZ)"
    echo "load machine: $(git -C "$HERE" log --oneline -1 2>/dev/null)"
    env | grep -E '^LOAD_' | grep -vE '^LOAD_(USER|INSECURE_TLS)=' | sort
    for node in $NODES; do
      ssh -o BatchMode=yes -o ConnectTimeout=5 "${SSH_USER:+$SSH_USER@}$node" \
        'for c in ideaf-app-1 ideaf-directory-1 ideaf-engine-1; do
           if docker inspect "$c" >/dev/null 2>&1; then
             printf "%s %s: %s, %s, version %s\n" "$(hostname)" "$c" "$(docker inspect -f "{{.State.Status}}" "$c")" \
               "$(docker inspect -f "{{.Config.Image}}" "$c")" \
               "$(docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" "$c" | sed -n "s/^RIVET_NODE_VERSION=//p")"
           fi
         done' 2>/dev/null || echo "$node: no answer"
    done
  } > "$1"
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

# one step's numbers from its k6 summary: rate, requests, failed (fraction), p95 (ms), and opening
# an idea's p95 (ms)
step_numbers() {
  jq -r --arg rate "$1" '.metrics | [$rate, (.http_reqs.count // 0), (.http_req_failed.value // 0),
    ((.http_req_duration["p(95)"] // 0) | floor), ((.op_open_idea["p(95)"] // 0) | floor),
    (.dropped_iterations.count // 0)] | @tsv' "$2"
}

steps() {
  local stamp folder
  stamp=$(date +%Y%m%d-%H%M%S)
  folder="steps-$stamp"
  mkdir -p "$DATA/results/$folder"
  local began
  began=$(date -u +%FT%TZ)
  meta "$DATA/results/$folder/meta.txt"
  local args=(-e LOAD_AUTH="${LOAD_AUTH:-jwt}" -e LOAD_VUS="${LOAD_VUS:-300}")
  echo "warm-up: ${LOAD_WARMUP_RATE:-30} page views a second for ${LOAD_WARMUP:-5m}"
  load "$folder/warmup" "${args[@]}" -e LOAD_RATE="${LOAD_WARMUP_RATE:-30}" -e LOAD_DURATION="${LOAD_WARMUP:-5m}" >/dev/null
  printf 'rate\trequests\tfailed\tp95_ms\topen_idea_p95_ms\tdropped\n' > "$DATA/results/$folder/steps.tsv"
  local rate summary line failed p95 dropped
  for rate in ${LOAD_STEPS:-40 60 80 100 120 140 160 180 200}; do
    load "$folder/rate-$rate" "${args[@]}" -e LOAD_RATE="$rate" -e LOAD_DURATION="${LOAD_STEP:-90s}" >/dev/null
    summary=$(ls -t "$DATA/results/$folder"/rate-"$rate"-*.json | head -1)
    line=$(step_numbers "$rate" "$summary")
    echo "$line" >> "$DATA/results/$folder/steps.tsv"
    read -r _ _ failed p95 _ dropped <<<"$line"
    echo "$rate page views a second: $(awk -v f="$failed" 'BEGIN { printf "%.2f%%", f * 100 }') failed, p95 ${p95} ms"
    if [ "${dropped:-0}" != 0 ]; then
      echo "  k6 dropped $dropped page views: it couldn't start them on time (too few VUs, or this machine short of CPU), so this step understates the deployment"
    fi
    if awk -v f="$failed" -v p="$p95" -v max="${LOAD_STOP_P95_MS:-1000}" 'BEGIN { exit !(f > 0.01 || p > max) }'; then
      echo "stopped: $rate is past what it holds"
      break
    fi
  done
  echo "steps: $DATA/results/$folder/steps.tsv"
  # before anything recreates the containers: the file store's summaries, and any warnings
  logs "$DATA/results/$folder/logs" "$began"
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
  steps)
    steps
    ;;
  check)
    bun "$HERE/src/check.ts"
    ;;
  probe)
    bun "$HERE/src/probe.ts"
    ;;
  logs)
    logs "$DATA/results/logs-$(date +%Y%m%d-%H%M%S)" "${2:-6h}"
    ;;
  down)
    dc down
    ;;
  *)
    sed -n '2,22p' "$0"
    exit 2
    ;;
esac
