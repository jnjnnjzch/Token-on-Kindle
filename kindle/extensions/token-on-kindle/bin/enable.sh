#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

touch "$ENABLED_FILE"
log_message "enable: sleep refresh enabled"

installed_upstart=0
if [ -d /etc/upstart ] && command -v mntroot >/dev/null 2>&1; then
    if mntroot rw >/dev/null 2>&1; then
        if cp "$SCRIPT_DIR/token-on-kindle.conf" /etc/upstart/token-on-kindle.conf; then
            installed_upstart=1
            log_message "enable: installed Upstart service"
        else
            log_message "enable: could not copy Upstart service"
        fi
        mntroot ro >/dev/null 2>&1 || true
    else
        log_message "enable: could not remount rootfs read-write"
    fi
fi

if [ "$installed_upstart" -eq 1 ] && command -v start >/dev/null 2>&1; then
    stop token-on-kindle >/dev/null 2>&1 || true
    if start token-on-kindle >/dev/null 2>&1; then
        exit 0
    fi
fi

/bin/sh "$SCRIPT_DIR/start.sh"
exit $?
