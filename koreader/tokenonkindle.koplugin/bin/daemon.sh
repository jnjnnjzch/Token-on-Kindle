#!/bin/sh

set -u

cd "$(dirname "$0")" || exit 1
SCRIPT_DIR="$(pwd)"
CONFIG_FILE="/mnt/us/token-on-kindle/config.sh"
PID_FILE="/tmp/token-on-kindle-helper.pid"
LOG_FILE="/tmp/token-on-kindle-helper.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"; }
cleanup() { if [ -f "$PID_FILE" ] && [ "$(cat "$PID_FILE" 2>/dev/null)" = "$$" ]; then rm -f "$PID_FILE"; fi; }
trap 'cleanup; exit 0' INT TERM HUP
trap cleanup EXIT

load_config() {
    [ -f "$CONFIG_FILE" ] || return 1
    . "$CONFIG_FILE"
    INTERVAL_SECONDS="${INTERVAL_SECONDS:-600}"
    case "$INTERVAL_SECONDS" in ''|*[!0-9]*) INTERVAL_SECONDS=600 ;; esac
    [ "$INTERVAL_SECONDS" -ge 60 ] || INTERVAL_SECONDS=60
}
run_update() {
    /bin/sh "$SCRIPT_DIR/update.sh"; rc=$?
    [ "$rc" -eq 0 ] || log "Update command failed with code $rc"
    return "$rc"
}
paint_cached_screen() {
    if [ -z "${OUTPUT_FILE:-}" ] || [ ! -s "$OUTPUT_FILE" ]; then log "Suspend paint skipped: no cached dashboard"; return 0; fi
    if ! command -v eips >/dev/null 2>&1; then log "Suspend paint skipped: eips not found"; return 0; fi
    eips -f -g "$OUTPUT_FILE" >/dev/null 2>&1 || true
    log "Cached dashboard painted at readyToSuspend"
}

if ! load_config; then log "Daemon cannot start without config"; exit 2; fi
NOW="$(date +%s)"; NEXT_UPDATE=$(( NOW + INTERVAL_SECONDS ))
log "No-framework-compatible helper started; next update in $INTERVAL_SECONDS seconds"

while :; do
    if ! load_config; then sleep 30; continue; fi
    NOW="$(date +%s)"; REMAINING=$(( NEXT_UPDATE - NOW )); [ "$REMAINING" -ge 1 ] || REMAINING=1
    EVENT="$(lipc-wait-event -s "$REMAINING" com.lab126.powerd readyToSuspend,wakeupFromSuspend,resuming 2>/dev/null || true)"
    NOW="$(date +%s)"
    case "$EVENT" in
        readyToSuspend*)
            paint_cached_screen
            REMAINING=$(( NEXT_UPDATE - NOW ))
            if [ "$REMAINING" -gt 0 ]; then lipc-set-prop -i com.lab126.powerd rtcWakeup "$REMAINING" >/dev/null 2>&1 || true; log "rtcWakeup set for $REMAINING seconds"; fi
            ;;
        wakeupFromSuspend*|resuming*)
            if [ "$NOW" -ge "$NEXT_UPDATE" ]; then run_update || true; NOW="$(date +%s)"; NEXT_UPDATE=$(( NOW + INTERVAL_SECONDS )); fi
            ;;
        *)
            if [ "$NOW" -ge "$NEXT_UPDATE" ]; then run_update || true; NOW="$(date +%s)"; NEXT_UPDATE=$(( NOW + INTERVAL_SECONDS )); fi
            ;;
    esac
done
