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
    # shellcheck disable=SC1090
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

if ! load_config; then
    log "Daemon cannot start without config"
    exit 2
fi

# The UI performs the explicit first sync after saving a URL. Starting the
# daemon with a full interval avoids two writers racing for dashboard.png.part.
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

    # Online Screen Saver's useful trick is powerd's rtcWakeup. Unlike its
    # original Upstart job, this daemon is deliberately not tied to lab126_gui.
    EVENT="$(lipc-wait-event -s "$REMAINING" com.lab126.powerd readyToSuspend,wakeupFromSuspend,resuming 2>/dev/null || true)"
    NOW="$(date +%s)"

    case "$EVENT" in
        readyToSuspend*)
            REMAINING=$(( NEXT_UPDATE - NOW ))
            if [ "$REMAINING" -gt 0 ]; then
                lipc-set-prop -i com.lab126.powerd rtcWakeup "$REMAINING" >/dev/null 2>&1 || true
                log "rtcWakeup set for $REMAINING seconds"
            fi
            ;;
        wakeupFromSuspend*|resuming*)
            # A scheduled RTC wake should not be treated as a user unlock. KOReader
            # handles WakeupFromSuspend separately from OutOfSS, so update the image
            # only when the interval is actually due.
            if [ "$NOW" -ge "$NEXT_UPDATE" ]; then
                run_update || true
                NOW="$(date +%s)"
                NEXT_UPDATE=$(( NOW + INTERVAL_SECONDS ))
            fi
            ;;
        *)
            # Timeout while awake, or an unrelated event: update only when due.
            if [ "$NOW" -ge "$NEXT_UPDATE" ]; then
                run_update || true
                NOW="$(date +%s)"
                NEXT_UPDATE=$(( NOW + INTERVAL_SECONDS ))
            fi
            ;;
    esac
done
