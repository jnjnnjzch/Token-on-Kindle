use super::{reload_sources, runtime_settings, AppState};
use serde::Serialize;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{AppHandle, Emitter, Manager, Window};

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
    let _ = app.handle().emit_to("main", "desktop-state-changed", info(app.handle()));
    let _ = tray.set_tooltip(Some("Token on Kindle · 托盘已就绪"));
    #[cfg(target_os = "macos")]
    app.handle().set_dock_visibility(false);
    let _ = rebuild_menu(app.handle());
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub(crate) fn build_tray(_app: &tauri::App) -> tauri::Result<()> { Ok(()) }

pub(crate) fn handle_window_event(window: &Window, event: &tauri::WindowEvent) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" || window.app_handle().state::<DesktopState>().tray_available.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}
