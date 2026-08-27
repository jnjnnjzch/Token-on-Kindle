#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

rm -f "$ENABLED_FILE"
pid="$(read_value "$PID_FILE")"
if pid_is_alive "$pid"; then
    kill "$pid" >/dev/null 2>&1 || true
fi
rm -f "$PID_FILE"
log_message "disable: sleep refresh disabled"
exit 0
