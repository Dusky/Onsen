#!/usr/bin/env bash
#
# Onsen dev-server helper. From the repo root:
#
#   scripts/onsen.sh start     start the dev server in the background
#   scripts/onsen.sh stop      stop it (the whole tree, not just the parent)
#   scripts/onsen.sh restart   stop, then start
#   scripts/onsen.sh status    is it up, and do the API and client answer
#   scripts/onsen.sh logs      follow the dev log
#
# The dev server is `concurrently` running `bun --watch` (API) and `vite`
# (client). They are started in their own session via `setsid`, so `stop`
# can take down every process with one kill of the process group rather than
# hunting PIDs.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/.onsen-dev.pid"
LOG="$ROOT/.onsen-dev.log"

API_PORT=8787
CLIENT_PORT=5173

# The primary LAN address, so `start` can say how to reach the app from a phone
# on the same network rather than only from this machine.
lan_ip() {
  ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || ipconfig getifaddr en0 2>/dev/null \
    || echo "localhost"
}

urls() {
  local ip
  ip="$(lan_ip)"
  echo "onsen: api    http://localhost:$API_PORT"
  echo "onsen: client http://localhost:$CLIENT_PORT"
  [ "$ip" = "localhost" ] || {
    echo "onsen: from a phone: http://$ip:$CLIENT_PORT"
  }
}

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "onsen: already running (pid $(cat "$PIDFILE"))"
    urls
    return 0
  fi
  cd "$ROOT"
  # setsid makes the server a session and process-group leader, so its PID is
  # its PGID and `kill -- -PID` reaches bun, concurrently and vite together.
  setsid nohup bun run dev >"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "onsen: started (pid $(cat "$PIDFILE")) — log at $LOG"
  urls
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
    curl -s -o /dev/null -w "onsen: api    -> %{http_code}\n" "http://localhost:$API_PORT/api/health" || echo "onsen: api    -> down"
    curl -s -o /dev/null -w "onsen: client -> %{http_code}\n" "http://localhost:$CLIENT_PORT" || echo "onsen: client -> down"
  else
    echo "onsen: not running"
  fi
}

logs() {
  exec tail -f "$LOG"
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  logs)    logs ;;
  *) echo "usage: $0 {start|stop|restart|status|logs}" >&2; exit 1 ;;
esac
