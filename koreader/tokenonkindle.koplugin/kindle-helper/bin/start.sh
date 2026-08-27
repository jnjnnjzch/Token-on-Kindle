#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

[ -f "$ENABLED_FILE" ] || exit 0

existing_pid="$(read_value "$PID_FILE")"
if pid_is_alive "$existing_pid"; then
    exit 0
fi

rm -f "$PID_FILE"
/bin/sh "$SCRIPT_DIR/scheduler.sh" >/dev/null 2>&1 &
pid=$!
printf '%s\n' "$pid" > "$PID_FILE"
log_message "start: scheduler launched pid=$pid"
exit 0
