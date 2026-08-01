# Token on Kindle for KOReader

This folder contains a KOReader plugin that turns the desktop application's `dashboard.png` into a one-step sleep-screen workflow.

## Install

Copy the complete folder:

```text
tokenonkindle.koplugin
```

into:

```text
koreader/plugins/
```

Restart KOReader, then open:

```text
Tools → Token on Kindle
```

## First-time setup

1. Keep the desktop Token on Kindle app running.
2. Copy the image URL shown by the desktop app, for example:

   ```text
   http://192.168.1.20:8765/dashboard.png
   ```

3. In KOReader choose **Token on Kindle → Set image URL**.
4. Choose **Sync dashboard now**.
5. Choose **Use as KOReader sleep screen**.

The plugin creates a dedicated folder containing only `dashboard.png`, then configures KOReader with:

```text
screensaver_type = random_image
screensaver_dir = <KOReader data>/screensavers/token-on-kindle
```

Because the directory contains one image, the sleep screen is deterministic rather than random.

## Automatic updates

Automatic sync defaults to every 10 minutes while KOReader is running. The plugin also schedules a refresh after resume and when the network reconnects. It deliberately does not start Wi-Fi or block on a network request while the Kindle is entering suspend; the last complete image remains available.

## Kindle linkss integration

When `/mnt/us/linkss/screensavers` exists, **Mirror to Kindle linkss** becomes available. The plugin copies the latest image to:

```text
/mnt/us/linkss/screensavers/token-on-kindle.png
```

This lets the same cached image be used by the Kindle screensaver hack when KOReader is not responsible for the sleep screen.

## Limits

- KOReader must be running for its scheduled downloader to execute.
- The desktop app remains responsible for logging into Codex and DeepSeek and producing the PNG.
- The Kindle and desktop computer must be able to reach each other on the local network.
- KOReader can scale the 3:4 dashboard to different Kindle screens; device-specific native-resolution dashboard profiles will be added separately for sharper text on high-DPI models.
