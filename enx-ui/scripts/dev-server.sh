#!/usr/bin/env bash
# enx-ui dev server control behind task ui:run / ui:stop / dev:web.
#
#   dev-server.sh fg          restart the dev server in the foreground
#   dev-server.sh bg          restart it in the background, wait until / answers
#   dev-server.sh stop        stop it
#   dev-server.sh open [PATH] open PATH (default /) in a new Chrome window,
#                             closing the window the previous `open` made
#
# Run from enx-ui/ with the pinned Node (the root Taskfile does both).
set -euo pipefail

PORT=3000
BASE_URL="http://localhost:${PORT}"
LOG_FILE="logs/ui-dev.log"
# Chrome window id of the last window `open` made. Ids restart when Chrome
# does, so the window is only closed if it is still showing localhost:3000.
WINDOW_FILE="logs/dev-web.window"

stop_server() {
  local pid cwd pgid
  pid=$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null | head -1 || true)
  [ -z "$pid" ] && return 0

  # Only kill our own dev server, never whatever else is on the port.
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  if [ "$cwd" != "$PWD" ]; then
    echo "❌ Port ${PORT} is held by PID ${pid} (cwd: ${cwd:-unknown}), not this enx-ui. Stop it first." >&2
    exit 1
  fi

  # `next dev` and its next-server child share a process group; killing the
  # group also lets the pnpm wrappers above it exit.
  pgid=$(ps -o pgid= -p "$pid" | tr -d ' ')
  echo "🛑 Stopping the running enx-ui dev server (process group ${pgid})..."
  kill -TERM -- "-${pgid}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    lsof -ti "tcp:${PORT}" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 0.5
  done
  kill -KILL -- "-${pgid}" 2>/dev/null || true
}

start_background() {
  mkdir -p logs
  echo "🚀 Starting the enx-ui dev server in the background (log: enx-ui/${LOG_FILE})..."
  nohup pnpm dev > "$LOG_FILE" 2>&1 &

  # The first request compiles the page, so wait for a real 200, not just
  # an open port.
  for _ in $(seq 1 90); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/" || true)" = "200" ]; then
      echo "✅ enx-ui is up at ${BASE_URL}"
      return 0
    fi
    sleep 1
  done
  echo "❌ enx-ui did not answer within 90s. Last log lines:" >&2
  tail -20 "$LOG_FILE" >&2
  exit 1
}

close_previous_window() {
  [ -f "$WINDOW_FILE" ] || return 0
  local id
  id=$(cat "$WINDOW_FILE")
  rm -f "$WINDOW_FILE"
  pgrep -xq "Google Chrome" || return 0
  osascript - "$id" "$BASE_URL" <<'EOF' >/dev/null || true
on run argv
  set wantedId to item 1 of argv
  set prefix to item 2 of argv
  tell application "Google Chrome"
    repeat with w in windows
      if (id of w as text) is wantedId then
        if (count of (tabs of w whose URL starts with prefix)) > 0 then close w
        exit repeat
      end if
    end repeat
  end tell
end run
EOF
}

open_window() {
  local url="${BASE_URL}${1:-/}" id
  close_previous_window
  mkdir -p logs
  id=$(osascript - "$url" <<'EOF'
on run argv
  tell application "Google Chrome"
    set w to make new window
    set URL of active tab of w to item 1 of argv
    activate
    return id of w
  end tell
end run
EOF
  )
  echo "$id" > "$WINDOW_FILE"
  echo "🌐 Opened ${url} in a new Chrome window"
}

case "${1:-}" in
  fg)
    stop_server
    exec pnpm dev
    ;;
  bg)
    stop_server
    start_background
    ;;
  stop)
    stop_server
    echo "✅ enx-ui dev server stopped"
    ;;
  open)
    open_window "${2:-/}"
    ;;
  *)
    echo "usage: $0 fg|bg|stop|open [PATH]" >&2
    exit 2
    ;;
esac
