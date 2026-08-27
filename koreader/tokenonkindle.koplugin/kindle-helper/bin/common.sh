#!/bin/sh

DATA_DIR="/mnt/us/token-on-kindle"
EXT_DIR="/mnt/us/extensions/token-on-kindle"
BIN_DIR="$EXT_DIR/bin"
URL_FILE="$DATA_DIR/url"
INTERVAL_FILE="$DATA_DIR/interval_minutes"
ENABLED_FILE="$DATA_DIR/background-enabled"
PID_FILE="$DATA_DIR/scheduler.pid"
LOG_FILE="$DATA_DIR/scheduler.log"
OUTPUT_FILE="$DATA_DIR/dashboard.png"
DISPLAY_PATH_FILE="$DATA_DIR/linkss-display-path"
LINKSS_DIR="/mnt/us/linkss/screensavers"

mkdir -p "$DATA_DIR" 2>/dev/null || true

log_message() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

read_value() {
    if [ -f "$1" ]; then
        sed -n '1p' "$1" | tr -d '\r'
    fi
}

interval_seconds() {
    minutes="$(read_value "$INTERVAL_FILE")"
    case "$minutes" in
        ''|*[!0-9]*) minutes=10 ;;
    esac
    if [ "$minutes" -lt 5 ]; then
        minutes=5
    fi
    echo $((minutes * 60))
}

current_time() {
    date +%s
}

is_png() {
    [ -f "$1" ] || return 1
    signature="$(dd if="$1" bs=8 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
    [ "$signature" = "89504e470d0a1a0a" ]
}

screen_saver_active() {
    command -v lipc-get-prop >/dev/null 2>&1 || return 1
    lipc-get-prop com.lab126.powerd status 2>/dev/null | grep -q "Screen Saver"
}

pid_is_alive() {
    pid="$1"
    case "$pid" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$pid" -gt 1 ] 2>/dev/null || return 1
    kill -0 "$pid" >/dev/null 2>&1
}
