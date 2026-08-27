#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

URL="$(read_value "$URL_FILE")"
if [ -z "$URL" ]; then
    log_message "update: no dashboard URL configured"
    exit 2
fi

TEMP_FILE="$OUTPUT_FILE.part.$$"
rm -f "$TEMP_FILE"

# A suspended Kindle may wake with the software Wi-Fi flag set while the radio
# is still unavailable. Assert both controls and give powerd enough time for a
# local-network request. Deliberately do NOT turn Wi-Fi off afterwards.
if command -v lipc-set-prop >/dev/null 2>&1; then
    lipc-set-prop -i com.lab126.powerd deferSuspend 60 >/dev/null 2>&1 || true
    lipc-set-prop -i com.lab126.cmd wirelessEnable 1 >/dev/null 2>&1 || true
    lipc-set-prop -i com.lab126.wifid enable 1 >/dev/null 2>&1 || true
fi

download_once() {
    rm -f "$TEMP_FILE"
    if command -v curl >/dev/null 2>&1; then
        curl -k -f -L --connect-timeout 5 --max-time 20 -o "$TEMP_FILE" "$URL" >/dev/null 2>&1
        return $?
    fi
    if [ -x /usr/bin/curl ]; then
        /usr/bin/curl -k -f -L --connect-timeout 5 --max-time 20 -o "$TEMP_FILE" "$URL" >/dev/null 2>&1
        return $?
    fi
    if command -v wget >/dev/null 2>&1; then
        wget -q -T 20 -O "$TEMP_FILE" "$URL" >/dev/null 2>&1
        return $?
    fi
    return 127
}

attempt=1
success=0
while [ "$attempt" -le 15 ]; do
    if download_once && is_png "$TEMP_FILE"; then
        success=1
        break
    fi
    rm -f "$TEMP_FILE"
    sleep 2
    attempt=$((attempt + 1))
done

if [ "$success" -ne 1 ]; then
    rm -f "$TEMP_FILE"
    log_message "update: download failed after 15 attempts: $URL"
    exit 3
fi

if ! mv -f "$TEMP_FILE" "$OUTPUT_FILE"; then
    rm -f "$TEMP_FILE"
    log_message "update: could not replace $OUTPUT_FILE"
    exit 4
fi

DISPLAY_FILE="$OUTPUT_FILE"
if [ -f "$SCRIPT_DIR/mirror-linkss.sh" ]; then
    /bin/sh "$SCRIPT_DIR/mirror-linkss.sh" "$OUTPUT_FILE" >/dev/null 2>&1 || true
fi

if [ -f "$DISPLAY_PATH_FILE" ]; then
    candidate="$(read_value "$DISPLAY_PATH_FILE")"
    if is_png "$candidate"; then
        DISPLAY_FILE="$candidate"
    fi
fi

if screen_saver_active && command -v eips >/dev/null 2>&1; then
    eips -f -g "$DISPLAY_FILE" >/dev/null 2>&1 || \
        log_message "update: eips could not refresh $DISPLAY_FILE"
fi

log_message "update: dashboard refreshed from $URL"
exit 0
