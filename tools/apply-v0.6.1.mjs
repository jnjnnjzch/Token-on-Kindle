import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = path => fs.readFileSync(path, 'utf8');
const write = (path, content) => {
  fs.mkdirSync(new URL('.', `file://${process.cwd()}/${path}`).pathname, { recursive: true });
  fs.writeFileSync(path, content, 'utf8');
};
const replaceOrThrow = (text, search, replacement, label) => {
  if (!text.includes(search)) throw new Error(`Missing ${label}`);
  return text.replace(search, replacement);
};

write('src-tauri/src/desktop.rs', String.raw`use super::{reload_sources, runtime_settings, AppState};
use serde::Serialize;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_autostart::ManagerExt as _;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_clipboard_manager::ClipboardExt as _;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_opener::OpenerExt as _;

#[derive(Debug, Clone)]
struct TraySnapshot {
    codex: String,
    deepseek: String,
    update: String,
    update_actionable: bool,
}

impl Default for TraySnapshot {
    fn default() -> Self {
        Self {
            codex: "需要登录".into(),
            deepseek: "需要登录".into(),
            update: "尚未检查".into(),
            update_actionable: false,
        }
    }
}

pub(crate) struct DesktopState {
    paused: AtomicBool,
    tray_available: AtomicBool,
    snapshot: Mutex<TraySnapshot>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            paused: AtomicBool::new(false),
            tray_available: AtomicBool::new(false),
            snapshot: Mutex::new(TraySnapshot::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopInfo {
    platform: String,
    tray_available: bool,
    paused: bool,
    autostart_enabled: bool,
    close_behavior: String,
}

fn clean(value: String, fallback: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let truncated = normalized.chars().take(72).collect::<String>();
    if truncated.is_empty() { fallback.into() } else { truncated }
}

pub(crate) fn is_paused(app: &AppHandle) -> bool {
    app.try_state::<DesktopState>()
        .map(|state| state.paused.load(Ordering::Relaxed))
        .unwrap_or(false)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn autostart_enabled(_app: &AppHandle) -> bool { false }

fn info(app: &AppHandle) -> DesktopInfo {
    let state = app.state::<DesktopState>();
    let tray_available = state.tray_available.load(Ordering::Relaxed);
    DesktopInfo {
        platform: std::env::consts::OS.into(),
        tray_available,
        paused: state.paused.load(Ordering::Relaxed),
        autostart_enabled: autostart_enabled(app),
        close_behavior: if tray_available {
            "关闭窗口后继续在托盘运行".into()
        } else {
            "当前系统托盘不可用，关闭主窗口将退出".into()
        },
    }
}

#[tauri::command]
pub(crate) fn get_desktop_state(app: AppHandle) -> DesktopInfo { info(&app) }

#[tauri::command]
pub(crate) fn set_collection_paused(app: AppHandle, paused: bool) -> Result<DesktopInfo, String> {
    app.state::<DesktopState>().paused.store(paused, Ordering::Relaxed);
    rebuild_menu(&app)?;
    Ok(info(&app))
}

#[tauri::command]
pub(crate) fn set_tray_source_status(
    app: AppHandle,
    codex: String,
    deepseek: String,
) -> Result<(), String> {
    {
        let state = app.state::<DesktopState>();
        let mut snapshot = state.snapshot.lock().map_err(|_| "托盘状态锁已损坏")?;
        snapshot.codex = clean(codex, "需要登录");
        snapshot.deepseek = clean(deepseek, "需要登录");
    }
    rebuild_menu(&app)
}

#[tauri::command]
pub(crate) fn set_tray_update_status(
    app: AppHandle,
    status: String,
    actionable: bool,
) -> Result<(), String> {
    {
        let state = app.state::<DesktopState>();
        let mut snapshot = state.snapshot.lock().map_err(|_| "托盘状态锁已损坏")?;
        snapshot.update = clean(status, "尚未检查");
        snapshot.update_actionable = actionable;
    }
    rebuild_menu(&app)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub(crate) fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<DesktopInfo, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| format!("无法启用开机启动：{error}"))?;
    } else {
        manager.disable().map_err(|error| format!("无法关闭开机启动：{error}"))?;
    }
    rebuild_menu(&app)?;
    Ok(info(&app))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub(crate) fn set_autostart_enabled(_app: AppHandle, _enabled: bool) -> Result<DesktopInfo, String> {
    Err("移动端不支持系统托盘与开机启动".into())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub(crate) fn copy_browser_url(app: AppHandle) -> Result<String, String> {
    let url = runtime_settings(&app.state::<AppState>()).browser_url;
    app.clipboard().write_text(url.clone()).map_err(|error| format!("复制失败：{error}"))?;
    Ok(url)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub(crate) fn copy_browser_url(_app: AppHandle) -> Result<String, String> {
    Err("移动端不提供托盘复制功能".into())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub(crate) fn open_browser_url(app: AppHandle) -> Result<String, String> {
    let url = runtime_settings(&app.state::<AppState>()).browser_url;
    app.opener().open_url(url.clone(), None::<&str>).map_err(|error| format!("无法打开浏览器：{error}"))?;
    Ok(url)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub(crate) fn open_browser_url(_app: AppHandle) -> Result<String, String> {
    Err("移动端不提供系统托盘浏览器入口".into())
}

pub(crate) fn init_plugins(app: &mut tauri::App) -> tauri::Result<()> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        app.handle().plugin(tauri_plugin_clipboard_manager::init())?;
        app.handle().plugin(tauri_plugin_opener::init())?;
        app.handle().plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Token on Kindle")
                .build(),
        )?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn toggle_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_main(app);
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn create_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<DesktopState>();
    let snapshot = state.snapshot.lock().map(|value| value.clone()).unwrap_or_default();
    let paused = state.paused.load(Ordering::Relaxed);
    let status = MenuItem::with_id(
        app,
        "status",
        format!("Codex {} · DeepSeek {}", snapshot.codex, snapshot.deepseek),
        false,
        None::<&str>,
    )?;
    let update_status = MenuItem::with_id(
        app,
        "update_status",
        format!("更新 · {}", snapshot.update),
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", "显示/隐藏看板", true, None::<&str>)?;
    let codex = MenuItem::with_id(app, "codex", "打开 Codex", true, None::<&str>)?;
    let deepseek = MenuItem::with_id(app, "deepseek", "打开 DeepSeek", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "立即刷新", true, None::<&str>)?;
    let pause = MenuItem::with_id(
        app,
        "pause",
        if paused { "恢复后台采集" } else { "暂停后台采集" },
        true,
        None::<&str>,
    )?;
    let open_browser = MenuItem::with_id(app, "open_browser", "在系统浏览器打开 Kindle 页面", true, None::<&str>)?;
    let copy_browser = MenuItem::with_id(app, "copy_browser", "复制 Kindle 浏览器地址", true, None::<&str>)?;
    let autostart = MenuItem::with_id(
        app,
        "autostart",
        if autostart_enabled(app) { "关闭开机启动" } else { "启用开机启动" },
        true,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(
        app,
        "update",
        if snapshot.update_actionable { "安装可用更新" } else { "检查应用更新" },
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出 Token on Kindle", true, None::<&str>)?;
    Menu::with_items(app, &[
        &status, &update_status, &show, &codex, &deepseek, &refresh, &pause,
        &open_browser, &copy_browser, &autostart, &update, &quit,
    ])
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn rebuild_menu(app: &AppHandle) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main") else { return Ok(()); };
    let menu = create_menu(app).map_err(|error| error.to_string())?;
    tray.set_menu(Some(menu)).map_err(|error| error.to_string())?;
    let snapshot = app.state::<DesktopState>().snapshot.lock().map(|value| value.clone()).unwrap_or_default();
    let paused = app.state::<DesktopState>().paused.load(Ordering::Relaxed);
    let tooltip = format!(
        "Token on Kindle · Codex {} · DeepSeek {} · {}{}",
        snapshot.codex,
        snapshot.deepseek,
        snapshot.update,
        if paused { " · 已暂停" } else { "" },
    );
    tray.set_tooltip(Some(tooltip.chars().take(220).collect::<String>()))
        .map_err(|error| error.to_string())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn rebuild_menu(_app: &AppHandle) -> Result<(), String> { Ok(()) }

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = create_menu(app.handle())?;
    let tray = TrayIconBuilder::with_id("main")
        .icon(tauri::include_image!("icons/icon.png"))
        .icon_as_template(false)
        .show_menu_on_left_click(false)
        .tooltip("Token on Kindle")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => toggle_main(app),
            "codex" => { let _ = super::open_source_impl(app, "codex"); }
            "deepseek" => { let _ = super::open_source_impl(app, "deepseek"); }
            "refresh" => { let _ = reload_sources(app); }
            "pause" => {
                let state = app.state::<DesktopState>();
                let paused = !state.paused.load(Ordering::Relaxed);
                state.paused.store(paused, Ordering::Relaxed);
                let _ = rebuild_menu(app);
                let _ = app.emit_to("main", "desktop-state-changed", info(app));
            }
            "open_browser" => { let _ = open_browser_url(app.clone()); }
            "copy_browser" => { let _ = copy_browser_url(app.clone()); }
            "autostart" => {
                let enabled = !autostart_enabled(app);
                let _ = set_autostart_enabled(app.clone(), enabled);
                let _ = app.emit_to("main", "desktop-state-changed", info(app));
            }
            "update" => {
                show_main(app);
                let install = app.state::<DesktopState>().snapshot.lock()
                    .map(|snapshot| snapshot.update_actionable)
                    .unwrap_or(false);
                let _ = app.emit_to("main", "desktop-update-action", serde_json::json!({ "install": install }));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => toggle_main(tray.app_handle()),
            TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => show_main(tray.app_handle()),
            _ => {}
        })
        .build(app)?;
    app.state::<DesktopState>().tray_available.store(true, Ordering::Relaxed);
    let _ = tray.set_tooltip(Some("Token on Kindle · 托盘已就绪"));
    #[cfg(target_os = "macos")]
    app.handle().set_dock_visibility(false);
    rebuild_menu(app.handle()).map_err(tauri::Error::AssetNotFound)?;
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub(crate) fn build_tray(_app: &tauri::App) -> tauri::Result<()> { Ok(()) }

pub(crate) fn handle_window_event(window: &WebviewWindow, event: &tauri::WindowEvent) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" || window.app_handle().state::<DesktopState>().tray_available.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}
`);

let lib = read('src-tauri/src/lib.rs');
lib = replaceOrThrow(lib,
`#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

const EXTRACTOR_SCRIPT`,
`mod desktop;
use desktop::{
    copy_browser_url, get_desktop_state, open_browser_url, set_autostart_enabled,
    set_collection_paused, set_tray_source_status, set_tray_update_status,
};

const EXTRACTOR_SCRIPT`,
'desktop module imports');
lib = replaceOrThrow(lib,
`        if timeout.timed_out() {
            let _ = reload_sources(&app);
        }`,
`        if timeout.timed_out() && !desktop::is_paused(&app) {
            let _ = reload_sources(&app);
        }`,
'paused scheduler');
const trayStart = lib.indexOf('#[cfg(not(any(target_os = "android", target_os = "ios")))]\nfn tray_icon()');
const runStart = lib.indexOf('#[cfg_attr(any(target_os = "android", target_os = "ios"), tauri::mobile_entry_point)]', trayStart);
if (trayStart < 0 || runStart < 0) throw new Error('Missing legacy tray block');
lib = lib.slice(0, trayStart) + lib.slice(runStart);
lib = replaceOrThrow(lib,
`    tauri::Builder::default()
        .manage(AppState {`,
`    tauri::Builder::default()
        .manage(desktop::DesktopState::default())
        .manage(AppState {`,
'desktop state registration');
lib = replaceOrThrow(lib,
`            refresh_sources,
            install_update
        ])`,
`            refresh_sources,
            install_update,
            get_desktop_state,
            set_collection_paused,
            set_autostart_enabled,
            set_tray_source_status,
            set_tray_update_status,
            copy_browser_url,
            open_browser_url
        ])`,
'desktop command registration');
lib = replaceOrThrow(lib,
`        .setup(move |app| {
            WebviewWindowBuilder::new`,
`        .setup(move |app| {
            desktop::init_plugins(app)?;
            WebviewWindowBuilder::new`,
'desktop plugin initialization');
lib = replaceOrThrow(lib,
`            start_refresh_scheduler(app.handle().clone(), Arc::clone(&refresh));
            build_tray(app)?;
            Ok(())`,
`            start_refresh_scheduler(app.handle().clone(), Arc::clone(&refresh));
            if let Err(error) = desktop::build_tray(app) {
                eprintln!("system tray unavailable: {error}");
            }
            Ok(())`,
'tray setup');
lib = replaceOrThrow(lib,
`        .on_window_event(|window, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })`,
`        .on_window_event(|window, event| desktop::handle_window_event(window, event))`,
'window close behavior');
write('src-tauri/src/lib.rs', lib);

write('web/desktop.js', String.raw`const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const panel = document.querySelector('#desktop-integration');
let desktop = null;
let syncTimer = null;

const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
const connectionText = source => {
  const status = text('#' + source + '-connection');
  const detail = text('#' + source + '-detail');
  return [status, detail].filter(Boolean).join(' · ');
};

function renderDesktopState(next) {
  desktop = next;
  if (!panel) return;
  if (['android', 'ios'].includes(next.platform)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  document.querySelector('#tray-state').textContent = next.trayAvailable ? '系统托盘已启用' : '系统托盘不可用';
  document.querySelector('#tray-detail').textContent = next.closeBehavior;
  const pause = document.querySelector('#toggle-collection');
  pause.textContent = next.paused ? '恢复后台采集' : '暂停后台采集';
  pause.dataset.active = String(next.paused);
  document.querySelector('#toggle-autostart').textContent = next.autostartEnabled ? '关闭开机启动' : '启用开机启动';
  document.body.dataset.collectionPaused = String(next.paused);
  if (next.paused) document.querySelector('#service').textContent = '后台采集已暂停 · 托盘仍在运行';
}

async function loadDesktopState() {
  if (!invoke) { if (panel) panel.hidden = true; return; }
  try { renderDesktopState(await invoke('get_desktop_state')); }
  catch { if (panel) panel.hidden = true; }
}

async function pushTrayStatus() {
  if (!invoke || !desktop || ['android', 'ios'].includes(desktop.platform)) return;
  const install = document.querySelector('#install-update');
  await Promise.allSettled([
    invoke('set_tray_source_status', {
      codex: connectionText('codex'),
      deepseek: connectionText('deepseek')
    }),
    invoke('set_tray_update_status', {
      status: text('#update-status'),
      actionable: Boolean(install && !install.hidden && !install.disabled)
    })
  ]);
}

function scheduleTraySync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushTrayStatus(), 120);
}

new MutationObserver(scheduleTraySync).observe(document.body, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['hidden', 'disabled', 'data-state']
});

document.querySelector('#toggle-collection')?.addEventListener('click', async () => {
  renderDesktopState(await invoke('set_collection_paused', { paused: !desktop.paused }));
});
document.querySelector('#toggle-autostart')?.addEventListener('click', async () => {
  renderDesktopState(await invoke('set_autostart_enabled', { enabled: !desktop.autostartEnabled }));
});
document.querySelector('#open-system-browser')?.addEventListener('click', async () => {
  await invoke('open_browser_url');
});
document.querySelector('#copy-kindle-url')?.addEventListener('click', async event => {
  const original = event.currentTarget.textContent;
  try {
    await invoke('copy_browser_url');
    event.currentTarget.textContent = '已复制';
  } finally {
    setTimeout(() => { event.currentTarget.textContent = original; }, 1200);
  }
});

listen?.('desktop-state-changed', event => renderDesktopState(event.payload));
listen?.('desktop-update-action', event => {
  document.querySelector('.app-update-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const selector = event.payload?.install ? '#install-update' : '#check-update';
  setTimeout(() => document.querySelector(selector)?.click(), 180);
});

await loadDesktopState();
scheduleTraySync();
`);

write('web/desktop.css', String.raw`.desktop-panel{padding:17px}.desktop-state{display:flex;align-items:center;gap:10px;margin-top:13px;padding:11px 12px;border:1px solid #d8d8d1;border-radius:12px;background:#f7f7f3}.desktop-indicator{width:10px;height:10px;border-radius:50%;background:#222;box-shadow:0 0 0 4px #e2e2dc}.desktop-state-copy{display:flex;min-width:0;flex-direction:column;gap:2px}.desktop-state-copy strong{font-size:12px}.desktop-state-copy small{overflow:hidden;color:#74746d;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.desktop-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.desktop-action{min-height:38px;padding:8px 10px;border:1px solid #bdbdb6;border-radius:10px;background:#fff;color:#262622;font-size:11px;font-weight:750;transition:.14s ease}.desktop-action:hover{transform:translateY(-1px);box-shadow:0 8px 18px rgba(0,0,0,.07)}.desktop-action[data-active="true"]{background:#1b1b1b;color:#fff}body[data-collection-paused="true"] .service-pill{border-color:#9d9271;background:#f7f2e5;color:#5d5338}@media(max-width:680px){.desktop-actions{grid-template-columns:1fr}}`);

let index = read('web/index.html');
index = replaceOrThrow(index,
`<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="update.css">`,
`<link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="update.css"><link rel="stylesheet" href="desktop.css">`,
'desktop stylesheet');
index = replaceOrThrow(index,
`<section class="panel app-update-panel">`,
`<section id="desktop-integration" class="panel desktop-panel" hidden><div class="section-title"><div><span class="eyebrow">DESKTOP INTEGRATION</span><h2>任务栏与后台</h2></div><span class="section-badge">桌面端</span></div><div class="desktop-state"><span class="desktop-indicator" aria-hidden="true"></span><span class="desktop-state-copy"><strong id="tray-state">正在读取系统托盘…</strong><small id="tray-detail">关闭窗口后的行为将在这里显示</small></span></div><div class="desktop-actions"><button id="toggle-collection" class="desktop-action">暂停后台采集</button><button id="toggle-autostart" class="desktop-action">启用开机启动</button><button id="open-system-browser" class="desktop-action">打开 Kindle 页面</button><button id="copy-kindle-url" class="desktop-action">复制 Kindle 地址</button></div><p class="help-text">左键单击托盘图标可显示或隐藏看板；Windows 双击会直接显示。macOS 使用菜单栏模式，Linux 托盘不可用时关闭主窗口会正常退出。</p></section><section class="panel app-update-panel">`,
'desktop panel');
index = replaceOrThrow(index,
`<script type="module" src="app.js"></script><script type="module" src="update.js"></script>`,
`<script type="module" src="app.js"></script><script type="module" src="update.js"></script><script type="module" src="desktop.js"></script>`,
'desktop script');
write('web/index.html', index);

let cargo = read('src-tauri/Cargo.toml');
cargo = cargo.replace('version = "0.6.0"', 'version = "0.6.1"');
cargo += `\n[target.'cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))'.dependencies]\ntauri-plugin-autostart = "2.5.1"\ntauri-plugin-clipboard-manager = "2.3.2"\ntauri-plugin-opener = "2.5.4"\n`;
write('src-tauri/Cargo.toml', cargo);

const pkg = JSON.parse(read('package.json'));
pkg.version = '0.6.1';
pkg.scripts.test = pkg.scripts.test.replace('node tools/apply-v0.6.1.mjs && ', '');
pkg.scripts.test += ' && node --check web/desktop.js';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

let conf = read('src-tauri/tauri.conf.json').replace('"version": "0.6.0"', '"version": "0.6.1"');
write('src-tauri/tauri.conf.json', conf);
write('web/version.js', '// Generated from the release tag / Cargo package version. Do not edit manually.\nexport const APP_VERSION = "0.6.1";\n');

write('tests/desktop-integration-contract.test.mjs', String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync('src-tauri/src/desktop.rs', 'utf8');
const html = fs.readFileSync('web/index.html', 'utf8');
const js = fs.readFileSync('web/desktop.js', 'utf8');
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');

test('desktop integrations use the real app icon and native tray events', () => {
  assert.match(rust, /include_image!\("icons\/icon\.png"\)/);
  assert.match(rust, /TrayIconEvent::Click/);
  assert.match(rust, /TrayIconEvent::DoubleClick/);
  assert.match(rust, /show_menu_on_left_click\(false\)/);
});

test('tray provides background, browser, update, and autostart controls', () => {
  for (const id of ['pause', 'open_browser', 'copy_browser', 'autostart', 'update']) {
    assert.match(rust, new RegExp('"' + id + '"'));
  }
  assert.match(cargo, /tauri-plugin-autostart/);
  assert.match(cargo, /tauri-plugin-clipboard-manager/);
  assert.match(cargo, /tauri-plugin-opener/);
});

test('desktop UI mirrors state and tray update actions', () => {
  assert.match(html, /id="desktop-integration"/);
  assert.match(html, /id="toggle-autostart"/);
  assert.match(js, /set_tray_source_status/);
  assert.match(js, /set_tray_update_status/);
  assert.match(js, /desktop-update-action/);
});

test('Linux has a safe close fallback and macOS uses menu bar mode', () => {
  assert.match(rust, /tray_available/);
  assert.match(rust, /set_dock_visibility\(false\)/);
  assert.match(rust, /window\.label\(\) != "main"/);
});
`);

let readme = read('README.md');
readme = readme.replace('## v0.6.0 维护更新', '## v0.6.1 桌面集成更新');
const marker = '## 使用方法';
const addition = `- Windows、macOS 与 Linux 使用正式应用图标作为任务栏/托盘图标。\n- 托盘实时显示 Codex、DeepSeek 与应用更新状态。\n- 托盘支持显示/隐藏看板、暂停/恢复采集、打开/复制 Kindle 地址、检查更新和退出。\n- 支持桌面端开机启动；macOS 使用菜单栏模式，Linux 托盘不可用时关闭主窗口会正常退出。\n\n`;
if (readme.includes(marker) && !readme.includes('托盘实时显示 Codex')) readme = readme.replace(marker, addition + marker);
write('README.md', readme);

try {
  execFileSync('cargo', ['generate-lockfile', '--manifest-path', 'src-tauri/Cargo.toml'], { stdio: 'inherit' });
} catch (error) {
  console.warn('Cargo.lock will be refreshed by the platform build:', error.message);
}

fs.rmSync('tools/apply-v0.6.1.mjs');

if (process.env.GITHUB_ACTIONS === 'true') {
  execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
  execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  execFileSync('git', ['add', '-A']);
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  if (status.trim()) {
    execFileSync('git', ['commit', '-m', 'v0.6.1: complete desktop tray and taskbar integration'], { stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', `HEAD:${process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME}`], { stdio: 'inherit' });
  }
}
