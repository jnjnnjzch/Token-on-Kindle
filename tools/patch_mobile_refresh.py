from pathlib import Path

path = Path("src-tauri/src/lib.rs")
source = path.read_text(encoding="utf-8")

replacements = [
    (
'''struct AppState {
    metrics: Mutex<MetricsState>,
    png: Arc<RwLock<Vec<u8>>>,
    port: u16,
}
''',
'''struct AppState {
    metrics: Mutex<MetricsState>,
    png: Arc<RwLock<Vec<u8>>>,
    port: u16,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    mobile_refresh: Mutex<bool>,
}
'''
    ),
    (
'''#[cfg(any(target_os = "android", target_os = "ios"))]
fn reload_sources(app: &AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    window.eval("location.reload()").map_err(|error| error.to_string())
}

#[tauri::command]
async fn refresh_sources(app: AppHandle) -> Result<(), String> {
    reload_sources(&app)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn start_refresh_scheduler(app: AppHandle) {
''',
'''#[cfg(any(target_os = "android", target_os = "ios"))]
fn reload_sources(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state
        .mobile_refresh
        .lock()
        .map_err(|_| "移动端刷新状态锁已损坏")? = true;
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    window
        .navigate(CODEX_URL.parse().map_err(|error| format!("URL 错误: {error}"))?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn refresh_sources(app: AppHandle) -> Result<(), String> {
    reload_sources(&app)
}

fn start_refresh_scheduler(app: AppHandle) {
'''
    ),
    (
'''fn return_to_dashboard(window: &WebviewWindow) {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        if let Ok(url) = dashboard_app_url().parse() {
            let _ = window.navigate(url);
        }
    }
''',
'''fn return_to_dashboard(window: &WebviewWindow) {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let state = window.app_handle().state::<AppState>();
        if let Ok(mut active) = state.mobile_refresh.lock() {
            *active = false;
        }
        if let Ok(url) = dashboard_app_url().parse() {
            let _ = window.navigate(url);
        }
    }
'''
    ),
    (
'''    let _ = app.emit_to("main", "metrics-updated", snapshot);
}

fn handle_client''',
'''    let _ = app.emit_to("main", "metrics-updated", snapshot);

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let active = state
            .mobile_refresh
            .lock()
            .map(|value| *value)
            .unwrap_or(false);
        if active {
            match source {
                "codex" => {
                    if let Ok(url) = DEEPSEEK_URL.parse() {
                        let _ = window.navigate(url);
                    }
                }
                "deepseek" => return_to_dashboard(window),
                _ => {}
            }
        }
    }
}

fn handle_client'''
    ),
    (
'''        .manage(AppState {
            metrics: Mutex::new(MetricsState::default()),
            png,
            port,
        })
''',
'''        .manage(AppState {
            metrics: Mutex::new(MetricsState::default()),
            png,
            port,
            #[cfg(any(target_os = "android", target_os = "ios"))]
            mobile_refresh: Mutex::new(false),
        })
'''
    ),
    (
'''            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                create_source_window(app, "codex")?;
                create_source_window(app, "deepseek")?;
                start_refresh_scheduler(app.handle().clone());
            }

            build_tray(app)?;
''',
'''            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                create_source_window(app, "codex")?;
                create_source_window(app, "deepseek")?;
            }

            start_refresh_scheduler(app.handle().clone());
            build_tray(app)?;
'''
    ),
]

for old, new in replacements:
    if old not in source:
        raise SystemExit(f"Expected Rust block was not found:\n{old[:160]}")
    source = source.replace(old, new, 1)

path.write_text(source, encoding="utf-8")
print("Added foreground mobile Codex/DeepSeek refresh sequencing")
# Touch after workflow creation so the one-shot patch is dispatched.
