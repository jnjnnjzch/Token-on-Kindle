#!/bin/sh

set -u

cd "$(dirname "$0")" || exit 1
SCRIPT_DIR="$(pwd)"
CONFIG_FILE="/mnt/us/token-on-kindle/config.sh"
PID_FILE="/tmp/token-on-kindle-helper.pid"
LOG_FILE="/tmp/token-on-kindle-helper.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"
}

cleanup() {
    if [ -f "$PID_FILE" ] && [ "$(cat "$PID_FILE" 2>/dev/null)" = "$$" ]; then
        rm -f "$PID_FILE"
    fi
}

trap 'cleanup; exit 0' INT TERM HUP
trap cleanup EXIT

load_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        return 1
    fi
    . "$CONFIG_FILE"
    INTERVAL_SECONDS="${INTERVAL_SECONDS:-600}"
    case "$INTERVAL_SECONDS" in
        ''|*[!0-9]*) INTERVAL_SECONDS=600 ;;
    esac
    if [ "$INTERVAL_SECONDS" -lt 60 ]; then
        INTERVAL_SECONDS=60
    fi
    return 0
}

run_update() {
    /bin/sh "$SCRIPT_DIR/update.sh"
    rc=$?
    if [ "$rc" -ne 0 ]; then
        log "Update command failed with code $rc"
    fi
    return "$rc"
}

paint_cached_screen() {
    if [ -z "${OUTPUT_FILE:-}" ] || [ ! -s "$OUTPUT_FILE" ]; then
        log "Suspend paint skipped: no cached dashboard"
        return 0
    fi
    if ! command -v eips >/dev/null 2>&1; then
        log "Suspend paint skipped: eips not found"
        return 0
    fi

    # readyToSuspend is itself the authoritative signal that the Kindle is about
    # to enter suspend. Do not wait for powerd's textual state to change to
    # "Screen Saver": on older Kindles that can happen after this event. KOReader
    # follows the same ordering internally: draw the sleep screen first, then
    # hand off to powerd for suspend.
    eips -f -g "$OUTPUT_FILE" >/dev/null 2>&1 || true
    log "Cached dashboard painted at readyToSuspend"
}

if ! load_config; then
    log "Daemon cannot start without config"
    exit 2
fi

NOW="$(date +%s)"
NEXT_UPDATE=$(( NOW + INTERVAL_SECONDS ))
log "No-framework-compatible helper started; next update in $INTERVAL_SECONDS seconds"

while :; do
    if ! load_config; then
        sleep 30
        continue
    fi

    NOW="$(date +%s)"
    REMAINING=$(( NEXT_UPDATE - NOW ))
    if [ "$REMAINING" -lt 1 ]; then
        REMAINING=1
    fi

    EVENT="$(lipc-wait-event -s "$REMAINING" com.lab126.powerd readyToSuspend,wakeupFromSuspend,resuming 2>/dev/null || true)"
    NOW="$(date +%s)"

    case "$EVENT" in
        readyToSuspend*)
            paint_cached_screen
            REMAINING=$(( NEXT_UPDATE - NOW ))
            if [ "$REMAINING" -gt 0 ]; then
                lipc-set-prop -i com.lab126.powerd rtcWakeup "$REMAINING" >/dev/null 2>&1 || true
                log "rtcWakeup set for $REMAINING seconds"
            fi
            ;;
        wakeupFromSuspend*|resuming*)
            if [ "$NOW" -ge "$NEXT_UPDATE" ]; then
                run_update || true
                NOW="$(date +%s)"
                NEXT_UPDATE=$(( NOW + INTERVAL_SECONDS ))
            fi
            ;;
        *)
            if [ "$NOW" -ge "$NEXT_UPDATE" ]; then
                run_update || true
                NOW="$(date +%s)"
                NEXT_UPDATE=$(( NOW + INTERVAL_SECONDS ))
            fi
            ;;
    esac
done
