#!/bin/sh

set -u

CONFIG_FILE="/mnt/us/token-on-kindle/config.sh"
LOG_FILE="/tmp/token-on-kindle-helper.log"
LOCK_DIR="/tmp/token-on-kindle-update.lock"
LOCK_HELD=0
WIFI_WAS_OFF=0

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"
}

restore_wifi() {
    if [ "${WIFI_WAS_OFF:-0}" = "1" ]; then
        lipc-set-prop -i com.lab126.wifid enable 0 >/dev/null 2>&1 || true
        lipc-set-prop -i com.lab126.cmd wirelessEnable 0 >/dev/null 2>&1 || true
        WIFI_WAS_OFF=0
        log "Wi-Fi restored to off"
    fi
}

cleanup() {
    restore_wifi
    if [ "$LOCK_HELD" = "1" ]; then
        rm -rf "$LOCK_DIR"
        LOCK_HELD=0
    fi
}

trap cleanup EXIT
trap 'exit 130' INT TERM HUP

acquire_lock() {
    ATTEMPTS=0
    while [ "$ATTEMPTS" -lt 35 ]; do
        if mkdir "$LOCK_DIR" 2>/dev/null; then
            echo "$$" > "$LOCK_DIR/pid"
            LOCK_HELD=1
            return 0
        fi

        OWNER="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
        case "$OWNER" in
            ''|*[!0-9]*)
                rm -rf "$LOCK_DIR" 2>/dev/null || true
                ;;
            *)
                if ! kill -0 "$OWNER" >/dev/null 2>&1; then
                    rm -rf "$LOCK_DIR" 2>/dev/null || true
                else
                    sleep 1
                fi
                ;;
        esac
        ATTEMPTS=$(( ATTEMPTS + 1 ))
    done
    log "Timed out waiting for another dashboard update"
    return 1
}

if ! acquire_lock; then
    exit 7
fi

if [ ! -f "$CONFIG_FILE" ]; then
    log "Missing config: $CONFIG_FILE"
    exit 2
fi

# shellcheck disable=SC1090
. "$CONFIG_FILE"

if [ -z "${IMAGE_URL:-}" ] || [ -z "${OUTPUT_FILE:-}" ]; then
    log "IMAGE_URL or OUTPUT_FILE is empty"
    exit 2
fi

NETWORK_TIMEOUT="${NETWORK_TIMEOUT:-25}"
LINKSS_FILE="${LINKSS_FILE:-}"
TMP_FILE="${OUTPUT_FILE}.part"

mkdir -p "$(dirname "$OUTPUT_FILE")" || exit 3
rm -f "$TMP_FILE"

# Match the legacy Online Screen Saver query form known to work on older Kindles.
WIFI_STATE="$(lipc-get-prop com.lab126.cmd wirelessEnable 2>/dev/null || echo 1)"
if [ "$WIFI_STATE" != "1" ]; then
    WIFI_WAS_OFF=1
    log "Wi-Fi is off; enabling it for this update"
    lipc-set-prop -i com.lab126.cmd wirelessEnable 1 >/dev/null 2>&1 || true
    lipc-set-prop -i com.lab126.wifid enable 1 >/dev/null 2>&1 || true
fi

DEADLINE=$(( $(date +%s) + NETWORK_TIMEOUT ))
DOWNLOADED=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    # Keep the curl options conservative for KT2-era firmware. The outer loop
    # supplies the overall network timeout and retries while Wi-Fi associates.
    if curl -fL -m 8 \
        -H 'Cache-Control: no-cache' \
        -H 'User-Agent: Token-on-Kindle/0.9.18 Kindle-helper' \
        "$IMAGE_URL" -o "$TMP_FILE" >/dev/null 2>&1; then
        DOWNLOADED=1
        break
    fi
    sleep 1
done

if [ "$DOWNLOADED" != "1" ] || [ ! -s "$TMP_FILE" ]; then
    rm -f "$TMP_FILE"
    log "Download failed: $IMAGE_URL"
    exit 4
fi

PNG_SIGNATURE="$(dd if="$TMP_FILE" bs=8 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
if [ "$PNG_SIGNATURE" != "89504e470d0a1a0a" ]; then
    rm -f "$TMP_FILE"
    log "Downloaded file is not PNG"
    exit 5
fi

# Same-filesystem rename keeps KOReader from ever seeing a partially written image.
mv -f "$TMP_FILE" "$OUTPUT_FILE" || exit 6
log "Dashboard updated: $OUTPUT_FILE"

# linkss is only a mirror. It is useful again when Amazon's framework is running,
# but the no-framework path never depends on it for the active KOReader sleep screen.
if [ -n "$LINKSS_FILE" ] && [ -d "$(dirname "$LINKSS_FILE")" ]; then
    LINKSS_TMP="${LINKSS_FILE}.part"
    if cp "$OUTPUT_FILE" "$LINKSS_TMP" && mv -f "$LINKSS_TMP" "$LINKSS_FILE"; then
        log "linkss mirror updated: $LINKSS_FILE"
    else
        rm -f "$LINKSS_TMP"
        log "linkss mirror failed"
    fi
fi

# RTC wakeups do not imply a user unlock. If powerd still reports Screen Saver,
# repaint only the framebuffer and leave KOReader asleep.
if lipc-get-prop com.lab126.powerd status 2>/dev/null | grep -q "Screen Saver"; then
    if command -v eips >/dev/null 2>&1; then
        eips -f -g "$OUTPUT_FILE" >/dev/null 2>&1 || true
        log "Active sleep screen repainted"
    fi
fi

exit 0
