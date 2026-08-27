#!/bin/sh

set -u

cd "$(dirname "$0")" || exit 1
SCRIPT_DIR="$(pwd)"
PID_FILE="/tmp/token-on-kindle-helper.pid"
LOG_FILE="/tmp/token-on-kindle-helper.log"

is_running() {
    if [ ! -f "$PID_FILE" ]; then
        return 1
    fi
    PID="$(cat "$PID_FILE" 2>/dev/null)"
    case "$PID" in
        ''|*[!0-9]*)
            rm -f "$PID_FILE"
            return 1
            ;;
    esac
    if kill -0 "$PID" >/dev/null 2>&1; then
        return 0
    fi
    rm -f "$PID_FILE"
    return 1
}

start_helper() {
    if is_running; then
        return 0
    fi

    # The daemon is launched after KOReader itself has entered no-framework mode.
    # It is not an Upstart child of lab126_gui, so stopping/restarting Amazon's
    # framework does not control its lifetime.
    (
        trap '' HUP
        exec /bin/sh "$SCRIPT_DIR/daemon.sh"
    ) </dev/null >>"$LOG_FILE" 2>&1 &
    PID=$!
    echo "$PID" > "$PID_FILE"
    sleep 1
    kill -0 "$PID" >/dev/null 2>&1
}

stop_helper() {
    if ! is_running; then
        rm -f "$PID_FILE"
        return 0
    fi
    PID="$(cat "$PID_FILE")"
    kill "$PID" >/dev/null 2>&1 || true
    i=0
    while kill -0 "$PID" >/dev/null 2>&1 && [ "$i" -lt 20 ]; do
        sleep 1
        i=$(( i + 1 ))
    done
    if kill -0 "$PID" >/dev/null 2>&1; then
        kill -9 "$PID" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
    return 0
}

case "${1:-status}" in
    start)
        start_helper
        ;;
    stop)
        stop_helper
        ;;
    restart)
        stop_helper && start_helper
        ;;
    once)
        /bin/sh "$SCRIPT_DIR/update.sh"
        ;;
    status)
        is_running
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|once|status}" >&2
        exit 2
        ;;
esac
