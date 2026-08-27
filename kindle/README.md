# Token on Kindle — Kindle sleep-refresh helper

This package is the system-level companion for the KOReader plugin. It exists for one reason: KOReader's Lua event loop is suspended while the Kindle sleeps, so a KOReader plugin alone cannot wake the device every few minutes and fetch a new image.

## Requirements

For a KT2 / Kindle Basic 2014 setup, the intended stack is:

1. jailbroken Kindle with KUAL/MRPI available for installing hacks;
2. NiLuJe-compatible `linkss` ScreenSavers Hack installed at `/mnt/us/linkss`;
3. the Token on Kindle KOReader plugin;
4. this helper extracted so that `/mnt/us/extensions/token-on-kindle/` exists.

`linkss` supplies its device detection and ImageMagick converter. On KT2 it resolves the screensaver canvas to 600x800 and the helper converts every downloaded dashboard to the same grayscale PNG8 format used by the ScreenSavers Hack itself before replacing its first screensaver slot.

## How sleep refresh works

The scheduler follows the same powerd/RTC pattern used by Online Screen Saver:

- while awake it waits on `com.lab126.powerd` events instead of busy-looping;
- on `readyToSuspend` it sets `com.lab126.powerd rtcWakeup` to the remaining refresh delay;
- when the RTC wakes the Kindle (or the user resumes it), it asks Kindle's Wi-Fi services to be enabled, retries the configured local dashboard URL, and atomically replaces `/mnt/us/token-on-kindle/dashboard.png`;
- it mirrors an eips-safe copy into linkss;
- if the device is still showing `Screen Saver`, it refreshes the framebuffer with `eips -f -g`;
- it then returns to the next sleep-aware wait.

Unlike the original Online Screen Saver script, this helper deliberately **does not disable Wi-Fi after a refresh**. That costs more battery but avoids a background updater unexpectedly forcing the Kindle back into a wireless-disabled / airplane-mode state.

## Installation

Extract the release helper ZIP at the Kindle USB-storage root. The resulting path must be:

```text
/mnt/us/extensions/token-on-kindle/menu.json
/mnt/us/extensions/token-on-kindle/bin/...
```

Set the dashboard URL from KOReader first. The plugin writes the shared configuration under `/mnt/us/token-on-kindle/`.

Then enable **Refresh while Kindle sleeps** from KOReader, or use KUAL:

```text
Token on Kindle → Enable sleep refresh
```

The enable script installs a tiny Upstart job on supported Kindle 5.x firmware so the scheduler survives KOReader exits and reboots. If Upstart installation is unavailable, it still starts a session-local scheduler.

## Files

```text
/mnt/us/token-on-kindle/url
/mnt/us/token-on-kindle/interval_minutes
/mnt/us/token-on-kindle/dashboard.png
/mnt/us/token-on-kindle/background-enabled
/mnt/us/token-on-kindle/scheduler.pid
/mnt/us/token-on-kindle/scheduler.log
```

Disable the helper from KOReader or KUAL before removing the extension.
