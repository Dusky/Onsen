#!/usr/bin/env bash
#
# Onsen dev-server helper. From the repo root:
#
#   scripts/onsen.sh start     start the dev server in the background
#   scripts/onsen.sh stop      stop it (the whole tree, not just the parent)
#   scripts/onsen.sh restart   stop, then start
#   scripts/onsen.sh status    is it up, and does the API answer
#
# The dev server is `concurrently` running `bun --watch` (API) and `vite`
# (client). They are started in their own session via `setsid`, so `stop`
# can take down every process with one kill of the process group rather than
# hunting PIDs.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.onsen-dev.pid"
LOG="$ROOT/.onsen-dev.log"

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "onsen: already running (pid $(cat "$PIDFILE"))"
    return 0
  fi
  cd "$ROOT"
  # setsid makes the server a session and process-group leader, so its PID is
  # its PGID and `kill -- -PID` reaches bun, concurrently and vite together.
  setsid nohup bun run dev >"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "onsen: started (pid $(cat "$PIDFILE")) — log at $LOG"
  echo "onsen: api on http://localhost:8787, client on http://localhost:5173"
}

stop() {
  if [ ! -f "$PIDFILE" ]; then
    echo "onsen: not running"
    return 0
  fi
  local pid
  pid="$(cat "$PIDFILE")"
  if kill -0 "$pid" 2>/dev/null; then
    # The negative PID is the whole process group (bun + concurrently + vite).
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    echo "onsen: stopped (pid $pid)"
  else
    echo "onsen: not running (stale pidfile, removed)"
  fi
  rm -f "$PIDFILE"
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "onsen: running (pid $(cat "$PIDFILE"))"
    curl -s -o /dev/null -w "onsen: api health -> %{http_code}\n" http://localhost:8787/api/health || true
  else
    echo "onsen: not running"
  fi
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 1 ;;
esac
