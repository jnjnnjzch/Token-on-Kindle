#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

cleanup() {
    current_pid="$(read_value "$PID_FILE")"
    if [ "$current_pid" = "$$" ]; then
        rm -f "$PID_FILE"
    fi
}
trap cleanup EXIT INT TERM

printf '%s\n' "$$" > "$PID_FILE"
log_message "scheduler: started pid=$$"

wait_until_next_refresh() {
    delay="$1"
    end_time=$(( $(current_time) + delay ))

    while [ -f "$ENABLED_FILE" ]; do
        remaining=$(( end_time - $(current_time) ))
        if [ "$remaining" -le 0 ]; then
            return 0
        fi

        if ! command -v lipc-wait-event >/dev/null 2>&1; then
            sleep "$remaining"
            return 0
        fi

        event="$(lipc-wait-event -s "$remaining" com.lab126.powerd readyToSuspend,wakeupFromSuspend,resuming 2>/dev/null)"
        remaining=$(( end_time - $(current_time) ))
        log_message "scheduler: power event: ${event:-timeout}; remaining=${remaining}s"

        case "$event" in
            readyToSuspend*)
                if [ "$remaining" -gt 0 ] && command -v lipc-set-prop >/dev/null 2>&1; then
                    lipc-set-prop -i com.lab126.powerd rtcWakeup "$remaining" >/dev/null 2>&1 || true
                    log_message "scheduler: rtcWakeup set to ${remaining}s"
                fi
                ;;
            wakeupFromSuspend*|resuming*)
                sleep 2
                return 0
                ;;
            *)
                ;;
        esac
    done
    return 1
}

while [ -f "$ENABLED_FILE" ]; do
    /bin/sh "$SCRIPT_DIR/update.sh" || true
    [ -f "$ENABLED_FILE" ] || break
    wait_until_next_refresh "$(interval_seconds)" || break
done

log_message "scheduler: stopped pid=$$"
exit 0
