from pathlib import Path

path = Path("src-tauri/src/lib.rs")
source = path.read_text(encoding="utf-8")

old = '''use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
'''

new = '''use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
'''

if old not in source:
    raise SystemExit("Tauri import block not found; refusing to patch")

path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Moved menu and tray imports behind desktop cfg")
# This file intentionally triggers the temporary one-shot patch workflow.
