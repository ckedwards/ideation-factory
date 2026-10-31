#!/usr/bin/env bash
# Restart the spike server: ./restart.sh [adapter|actor]   (./restart.sh stop to stop)
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.."
pidfile="$here/out/server.pid"
if [ -f "$pidfile" ]; then kill "$(cat "$pidfile")" 2>/dev/null; sleep 1; rm -f "$pidfile"; fi
for pid in $(ss -ltnpH 'sport = :25445' | grep -o 'pid=[0-9]*' | cut -d= -f2); do kill "$pid"; done
[ "$1" = stop ] && exit 0
mode=${1:-adapter}
: > "$here/out/server-$mode.log"
SPIKE_STORAGE=$mode setsid bun scripts/worktree.ts exec -- bun "$here/src/server.ts" >> "$here/out/server-$mode.log" 2>&1 &
echo $! > "$pidfile"
for i in $(seq 1 60); do curl -sf localhost:25445/health >/dev/null && break; sleep 0.5; done
curl -s localhost:25445/health; echo
