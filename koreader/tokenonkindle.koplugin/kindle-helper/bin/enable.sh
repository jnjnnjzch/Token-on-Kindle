#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

touch "$ENABLED_FILE"
log_message "enable: sleep refresh enabled"
/bin/sh "$SCRIPT_DIR/start.sh"
exit $?
