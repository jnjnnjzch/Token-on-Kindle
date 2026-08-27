#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/common.sh"

SOURCE_FILE="${1:-$OUTPUT_FILE}"
LINKSS_BASE="/mnt/us/linkss"
LINKSS_LIB="$LINKSS_BASE/bin/libkh5"
LINKSS_CONVERT="$LINKSS_BASE/bin/convert"

if ! is_png "$SOURCE_FILE"; then
    log_message "mirror-linkss: source is not a PNG: $SOURCE_FILE"
    exit 2
fi

if [ ! -d "$LINKSS_DIR" ] || [ ! -f "$LINKSS_LIB" ] || [ ! -x "$LINKSS_CONVERT" ]; then
    log_message "mirror-linkss: linkss with libkh5/convert is not available"
    exit 3
fi

KH_HACKNAME="linkss"
export KH_HACKNAME
. "$LINKSS_LIB"

if [ "${K5_ATLEAST_55:-false}" = "true" ]; then
    ss_prefix="bg_ss"
elif [ "${IS_PW:-false}" = "true" ]; then
    ss_prefix="bg_medium_ss"
else
    ss_prefix="bg_xsmall_ss"
fi

TARGET_FILE="$LINKSS_DIR/${ss_prefix}00.png"
TEMP_FILE="/tmp/token-on-kindle-linkss.$$.png"
rm -f "$TEMP_FILE"

DITHER_ARGS=""
if [ -f "$LINKSS_BASE/etc/kindle_colors.gif" ]; then
    DITHER_ARGS="-dither FloydSteinberg -remap $LINKSS_BASE/etc/kindle_colors.gif"
fi

# Match linkss' own cover pipeline: exact device size, grayscale, eips-safe PNG8.
# KT2 is detected by libkh5 and resolves MY_SCREEN_SIZE to 600x800.
# shellcheck disable=SC2086
"$LINKSS_CONVERT" "$SOURCE_FILE" \
    -filter LanczosSharp \
    -resize "${MY_SCREEN_SIZE:-600x800}!" \
    -colorspace Gray \
    $DITHER_ARGS \
    -quality 75 \
    -define png:color-type=0 \
    -define png:bit-depth=8 \
    "$TEMP_FILE"

if [ $? -ne 0 ] || ! is_png "$TEMP_FILE"; then
    rm -f "$TEMP_FILE"
    log_message "mirror-linkss: convert failed"
    exit 4
fi

mv -f "$TEMP_FILE" "$TARGET_FILE"
printf '%s\n' "$TARGET_FILE" > "$DISPLAY_PATH_FILE"
log_message "mirror-linkss: updated $TARGET_FILE (${MY_SCREEN_SIZE:-unknown})"
exit 0
