# Token on Kindle for KOReader

The KOReader plugin has two deliberately separated layers:

- the Lua plugin provides configuration, foreground refresh, status, and KOReader's normal sleep-screen integration;
- a small bundled Kindle helper handles RTC wakeups and network refreshes after the Kindle has actually suspended.

The helper is shipped **inside the same `tokenonkindle.koplugin` folder**. The plugin installs/updates it into `/mnt/us/extensions/token-on-kindle` automatically, so there is only one package to install.

## Install

Copy the complete folder:

```text
tokenonkindle.koplugin
```

into:

```text
koreader/plugins/
```

Restart KOReader. The entry appears under **More tools → Token on Kindle** in both File Manager and Reader UI.

## First setup

1. Keep the desktop Token on Kindle app running on the same LAN.
2. Open **Token on Kindle → Set dashboard URL**.
3. Enter the `dashboard.png` URL shown by the desktop app, for example:

   ```text
   http://192.168.1.20:8765/dashboard.png
   ```

4. The dialog closes first, then the plugin performs the refresh. A LAN connection is sufficient; general Internet access is not required.
5. Leave **Use as KOReader sleep screen** enabled if you want KOReader itself to show the dashboard when it enters sleep.

The cached image is:

```text
/mnt/us/token-on-kindle/dashboard.png
```

KOReader is configured using its native single-file wallpaper contract:

```text
screensaver_type = document_cover
screensaver_document_cover = /mnt/us/token-on-kindle/dashboard.png
```

If `Device:supportsScreensaver()` is false, the plugin reports that limitation instead of claiming that the setting worked.

## Refresh while the Kindle sleeps

Enable:

```text
Token on Kindle → Refresh while Kindle sleeps
```

The bundled helper is copied to:

```text
/mnt/us/extensions/token-on-kindle/
```

and a user-storage scheduler is started. The scheduler follows the powerd/RTC pattern used by Online Screen Saver:

- wait for `readyToSuspend`, `wakeupFromSuspend`, and `resuming` events;
- set `com.lab126.powerd rtcWakeup` before suspend;
- after RTC/manual wake, keep powerd awake long enough for networking;
- assert both Kindle Wi-Fi controls on, retry the configured local dashboard URL, and replace the cache atomically;
- mirror a Kindle-safe copy into linkss;
- if `powerd` still reports `Screen Saver`, redraw it with `eips -f -g`.

The helper deliberately **does not turn Wi-Fi off again** after a refresh. This consumes more battery but avoids a background refresh unexpectedly pushing the device toward a wireless-disabled/airplane-mode state.

This first bundled helper intentionally stays in `/mnt/us` and does not modify `/etc/upstart` or other root-filesystem services. It survives normal Kindle suspend/resume. After a full reboot, opening KOReader restarts it automatically if sleep refresh was enabled.

## linkss / KT2

If NiLuJe-compatible `linkss` is installed at `/mnt/us/linkss`, every successful refresh also updates its first screensaver slot. There is no separate mirror toggle.

The helper sources linkss' own `bin/libkh5` and uses linkss' bundled `bin/convert`. That matters on KT2: `libkh5` identifies KT2 and resolves the screensaver canvas to 600x800. The helper then uses the same important constraints as linkss' cover pipeline:

- exact device size;
- grayscale;
- optional Kindle palette dithering;
- `png:color-type=0`;
- `png:bit-depth=8`.

This is intentionally different from the old plugin, which merely copied any file with a PNG signature into the linkss directory.

## Refresh interval

10, 30, and 60 minute choices control the system-level sleep-aware scheduler. The KOReader Lua layer does **not** run an endless `UIManager:scheduleIn` loop. It refreshes on explicit request and opportunistically after KOReader resume/network connection.

## Status and repair

Use:

```text
Token on Kindle → Status
```

to inspect the URL, last successful refresh, KOReader screensaver support, helper installation/running state, linkss availability, and log path.

The helper log is:

```text
/mnt/us/token-on-kindle/scheduler.log
```

If helper files were removed or damaged, use:

```text
Token on Kindle → Install / repair sleep helper
```

## Why the old plugin could crash during configuration

The previous downloader used:

```lua
local ok, code, _, status = http.request(...)
```

The local `_` replaced KOReader's gettext function with the HTTP response-header table. As soon as the request completed, code such as `_("Token on Kindle dashboard updated.")` attempted to call that table and raised a Lua error. Saving the URL immediately started a refresh, so it looked as if the configuration dialog itself crashed KOReader.

The rewritten downloader names the value `response_headers`, wraps the request in `pcall`, closes the dialog first, and performs the post-save refresh with `UIManager:nextTick`.
