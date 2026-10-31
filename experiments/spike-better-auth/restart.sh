#!/usr/bin/env bash
# Restart the spike server: ./restart.sh [adapter|actor]   (./restart.sh stop to stop)
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.."
port_pids() { ss -ltnpH 'sport = :25445' | grep -o 'pid=[0-9]*' | cut -d= -f2; }
for pid in $(port_pids); do kill "$pid"; done
for i in $(seq 1 100); do [ -z "$(port_pids)" ] && break; sleep 0.1; done
[ "$1" = stop ] && exit 0
mode=${1:-adapter}
: > "$here/out/server-$mode.log"
SPIKE_SQL_LOG=$SPIKE_SQL_LOG SPIKE_STORAGE=$mode bun scripts/worktree.ts exec -- bun "$here/src/server.ts" >> "$here/out/server-$mode.log" 2>&1 &
disown
for i in $(seq 1 240); do curl -sf localhost:25445/health >/dev/null && break; sleep 0.25; done
curl -s localhost:25445/health; echo
