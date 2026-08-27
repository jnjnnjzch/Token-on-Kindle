# Token on Kindle for KOReader

The KOReader plugin now has one small job: keep a local copy of `dashboard.png`, point KOReader's own sleep-screen setting at that file, and provide a safe configuration/status UI.

Updating the image **while the Kindle is actually suspended** is handled by the separate Kindle helper package, not by a Lua timer inside KOReader.

## Install the KOReader plugin

Copy the complete folder:

```text
tokenonkindle.koplugin
```

into:

```text
koreader/plugins/
```

Restart KOReader. The entry appears under **Tools / More tools → Token on Kindle** in both File Manager and Reader UI.

## First setup

1. Keep the desktop Token on Kindle app running on the same LAN.
2. Open **Token on Kindle → Set dashboard URL**.
3. Enter the `dashboard.png` URL shown by the desktop app, for example:

   ```text
   http://192.168.1.20:8765/dashboard.png
   ```

4. The dialog closes first, then the plugin performs a refresh. A local-network connection is sufficient; the plugin does not require general Internet access.
5. Leave **Use as KOReader sleep screen** enabled if you want KOReader to show the dashboard whenever KOReader itself enters its sleep screen.

The cached image lives at:

```text
/mnt/us/token-on-kindle/dashboard.png
```

KOReader is configured with its native single-file wallpaper setting:

```text
screensaver_type = document_cover
screensaver_document_cover = /mnt/us/token-on-kindle/dashboard.png
```

If `Device:supportsScreensaver()` is false (for example because the Kindle native Special Offers path owns the sleep screen), the plugin reports that limitation instead of claiming success.

## Refreshing while asleep

KOReader cannot run its normal Lua timers while the Kindle is suspended. For periodic updates on the already-visible lock screen, install the separate release asset:

```text
Token-on-Kindle-vX.Y.Z-kindle-helper.zip
```

Extract it at the Kindle USB-storage root so this exists:

```text
/mnt/us/extensions/token-on-kindle/
```

The intended KT2 setup also has NiLuJe-compatible `linkss` installed at:

```text
/mnt/us/linkss/
```

Then enable:

```text
Token on Kindle → Refresh while Kindle sleeps
```

The helper uses Kindle `powerd` RTC wakeups, enables Wi-Fi when it wakes, downloads the newest dashboard, converts/mirrors it to the linkss screensaver slot, and uses `eips` to redraw the image if the device is still in Screen Saver state. It deliberately does not turn Wi-Fi back off after a refresh.

See `kindle/README.md` in the repository/helper package for the exact system-level behavior.

## linkss behavior

There is no longer a separate "Mirror to linkss" toggle. If linkss and the Kindle helper are installed, every successful refresh opportunistically updates linkss too.

The helper does **not** blindly copy an arbitrary RGB PNG. It sources linkss' own device data (`libkh5`) and uses linkss' bundled `convert` tool. On KT2 this resolves to a 600x800 canvas and produces grayscale 8-bit PNG output suitable for `eips`/the screensaver hack.

## Refresh interval

The 10/30/60 minute interval controls the system-level sleep-refresh scheduler. The KOReader plugin itself does not run an endless periodic timer. It refreshes on explicit user request and opportunistically after KOReader resume/network connection.

## Troubleshooting

Open **Token on Kindle → Status** to see the configured URL, last successful refresh, KOReader screensaver support, helper installation/running state, linkss availability, and the helper log path:

```text
/mnt/us/token-on-kindle/scheduler.log
```

If the configuration dialog previously appeared to crash KOReader: the old plugin accidentally stored the HTTP response headers in a local variable named `_`, shadowing KOReader's gettext function, and then attempted to call that table as a function after the request completed. The rewritten plugin removes that failure mode and defers the post-dialog refresh with `UIManager:nextTick`.
