use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{Arc, Mutex, RwLock},
    thread,
    time::Duration,
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const EXTRACTOR_SCRIPT: &str = include_str!("../../web/extractor.js");
const CODEX_URL: &str = "https://chatgpt.com/codex/cloud/settings/analytics";
const DEEPSEEK_URL: &str = "https://platform.deepseek.com/usage";
const SIGNAL_PREFIX: &str = "__TOKEN_ON_KINDLE__:";
const ACTION_PREFIX: &str = "__TOKEN_ON_KINDLE_ACTION__:";
const REFRESH_SECONDS: u64 = 10 * 60;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetricsState {
    codex: Option<Value>,
    deepseek: Option<Value>,
    received_at: Option<String>,
}

struct AppState {
    metrics: Mutex<MetricsState>,
    png: Arc<RwLock<Vec<u8>>>,
    port: u16,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    mobile_refresh: Mutex<bool>,
}

fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn profile_dimensions(profile: &str) -> Option<(u32, u32)> {
    match profile {
        "kindle-600x800" => Some((600, 800)),
        "kindle-758x1024" => Some((758, 1024)),
        "kindle-1072x1448" => Some((1072, 1448)),
        "kindle-1080x1440" => Some((1080, 1440)),
        "kindle-1236x1648" => Some((1236, 1648)),
        "kindle-1264x1680" => Some((1264, 1680)),
        "kindle-1860x2480" => Some((1860, 2480)),
        _ => None,
    }
}

fn validate_png(bytes: &[u8], profile: &str) -> Result<(), String> {
    const SIG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 33 || &bytes[..8] != SIG {
        return Err("不是有效的 PNG 文件".into());
    }

    let (expected_width, expected_height) = profile_dimensions(profile)
        .ok_or_else(|| format!("不支持的 Kindle 屏幕配置：{profile}"))?;
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    let bit_depth = bytes[24];
    let color_type = bytes[25];

    if (width, height) != (expected_width, expected_height) {
        return Err(format!(
            "配置 {profile} 需要 {expected_width}×{expected_height}；实际为 {width}×{height}"
        ));
    }
    if (bit_depth, color_type) != (8, 0) {
        return Err(format!(
            "Kindle 图片必须是 8 位灰度 PNG；实际 bitDepth={bit_depth}, colorType={color_type}"
        ));
    }
    Ok(())
}

#[tauri::command]
fn set_dashboard_png(
    bytes: Vec<u8>,
    profile: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    validate_png(&bytes, &profile)?;
    *state.png.write().map_err(|_| "PNG 锁已损坏")? = bytes;
    Ok(())
}

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> MetricsState {
    state.metrics.lock().map(|s| s.clone()).unwrap_or_default()
}

fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("8.8.8.8:80")?;
            socket.local_addr()
        })
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

#[tauri::command]
fn get_dashboard_url(state: State<'_, AppState>) -> String {
    format!("http://{}:{}/dashboard.png", local_ip(), state.port)
}

fn source_url(source: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match source {
        "codex" => Ok(("codex-login", "Codex Analytics", CODEX_URL)),
        "deepseek" => Ok(("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL)),
        _ => Err("未知数据源".into()),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn create_source_window(app: &tauri::App, source: &str) -> tauri::Result<()> {
    let (label, title, url) = match source {
        "codex" => ("codex-login", "Codex Analytics", CODEX_URL),
        "deepseek" => ("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL),
        _ => unreachable!("only static sources are created"),
    };
    let parsed = url.parse().expect("static source URL must be valid");
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(1180.0, 820.0)
        .visible(false)
        .initialization_script(EXTRACTOR_SCRIPT)
        .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
        .build()?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
    let (label, _, _) = source_url(source)?;
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} 后台窗口尚未创建"))?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
    let (_, _, url) = source_url(source)?;
    let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
    window
        .navigate(url.parse().map_err(|error| format!("URL 错误: {error}"))?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_source(app: AppHandle, source: String) -> Result<(), String> {
    open_source_impl(&app, &source)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reload_sources(app: &AppHandle) -> Result<(), String> {
    let mut refreshed = 0;
    for label in ["codex-login", "deepseek-login"] {
        if let Some(window) = app.get_webview_window(label) {
            window.eval("location.reload()").map_err(|error| error.to_string())?;
            refreshed += 1;
        }
    }
    if refreshed == 0 {
        return Err("没有可刷新的后台窗口".into());
    }
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
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
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(REFRESH_SECONDS));
        let _ = reload_sources(&app);
    });
}

fn decode_base64_url(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buffer: u32 = 0;
    let mut bits = 0u8;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return Err("无效的 base64url".into()),
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

fn dashboard_app_url() -> &'static str {
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        "http://tauri.localhost/index.html"
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        "tauri://localhost/index.html"
    }
}

fn return_to_dashboard(window: &WebviewWindow) {
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
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = window.hide();
        if let Some(main) = window.app_handle().get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
}

fn handle_title_signal(window: &WebviewWindow, title: &str) {
    if let Some(action) = title.strip_prefix(ACTION_PREFIX) {
        if action == "dashboard" {
            return_to_dashboard(window);
        }
        return;
    }
    let Some(rest) = title.strip_prefix(SIGNAL_PREFIX) else {
        return;
    };
    let mut parts = rest.splitn(2, ':');
    let source = parts.next().unwrap_or_default();
    let encoded = parts.next().unwrap_or_default();
    let Ok(decoded) = decode_base64_url(encoded) else {
        return;
    };
    let Ok(payload) = serde_json::from_slice::<Value>(&decoded) else {
        return;
    };

    let app = window.app_handle();
    let state = app.state::<AppState>();
    let snapshot = {
        let Ok(mut metrics) = state.metrics.lock() else {
            return;
        };
        match source {
            "codex" => metrics.codex = Some(payload),
            "deepseek" => metrics.deepseek = Some(payload),
            _ => return,
        }
        metrics.received_at = Some(timestamp());
        metrics.clone()
    };
    let _ = app.emit_to("main", "metrics-updated", snapshot);

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

fn handle_client(mut stream: TcpStream, png: Arc<RwLock<Vec<u8>>>) {
    let mut request = [0u8; 2048];
    let count = stream.read(&mut request).unwrap_or(0);
    let first_line = String::from_utf8_lossy(&request[..count]);
    let path = first_line
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/");

    if path == "/dashboard.png" {
        let bytes = png.read().map(|value| value.clone()).unwrap_or_default();
        if bytes.is_empty() {
            let body = b"dashboard has not been rendered yet";
            let header = format!(
                "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(body);
            return;
        }
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
            bytes.len()
        );
        let _ = stream.write_all(header.as_bytes());
        let _ = stream.write_all(&bytes);
    } else if path == "/healthz" {
        let body = b"{\"ok\":true}";
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(header.as_bytes());
        let _ = stream.write_all(body);
    } else {
        let body = b"Token on Kindle";
        let header = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let _ = stream.write_all(header.as_bytes());
        let _ = stream.write_all(body);
    }
}

fn bind_http_server() -> Result<(TcpListener, u16), String> {
    for port in 8765..=8785 {
        if let Ok(listener) = TcpListener::bind(("0.0.0.0", port)) {
            return Ok((listener, port));
        }
    }
    Err("8765–8785 端口均被占用".into())
}

fn start_http_server(listener: TcpListener, png: Arc<RwLock<Vec<u8>>>) {
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let png = Arc::clone(&png);
            thread::spawn(move || handle_client(stream, png));
        }
    });
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn tray_icon() -> Image<'static> {
    const SIZE: u32 = 32;
    let mut rgba = vec![255u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let border = x < 3 || y < 3 || x >= SIZE - 3 || y >= SIZE - 3;
            let bar = (8..=23).contains(&y) && x >= 7 && x <= 24;
            let fill = bar && x <= 18;
            if border || fill {
                let offset = ((y * SIZE + x) * 4) as usize;
                rgba[offset] = 0;
                rgba[offset + 1] = 0;
                rgba[offset + 2] = 0;
                rgba[offset + 3] = 255;
            }
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示看板", true, None::<&str>)?;
    let codex = MenuItem::with_id(app, "codex", "打开 Codex", true, None::<&str>)?;
    let deepseek = MenuItem::with_id(app, "deepseek", "打开 DeepSeek", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "立即刷新", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &codex, &deepseek, &refresh, &quit])?;
    TrayIconBuilder::new()
        .icon(tray_icon())
        .tooltip("Token on Kindle")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "codex" => {
                let _ = open_source_impl(app, "codex");
            }
            "deepseek" => {
                let _ = open_source_impl(app, "deepseek");
            }
            "refresh" => {
                let _ = reload_sources(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn build_tray(_app: &tauri::App) -> tauri::Result<()> {
    Ok(())
}

#[cfg_attr(any(target_os = "android", target_os = "ios"), tauri::mobile_entry_point)]
pub fn run() {
    let (listener, port) = bind_http_server().expect("failed to bind local HTTP server");
    let png = Arc::new(RwLock::new(Vec::new()));
    start_http_server(listener, Arc::clone(&png));

    tauri::Builder::default()
        .manage(AppState {
            metrics: Mutex::new(MetricsState::default()),
            png,
            port,
            #[cfg(any(target_os = "android", target_os = "ios"))]
            mobile_refresh: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            set_dashboard_png,
            get_status,
            get_dashboard_url,
            open_source,
            refresh_sources
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Token on Kindle")
                .inner_size(1080.0, 760.0)
                .min_inner_size(760.0, 580.0)
                .initialization_script(EXTRACTOR_SCRIPT)
                .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
                .build()?;

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                create_source_window(app, "codex")?;
                create_source_window(app, "deepseek")?;
            }

            start_refresh_scheduler(app.handle().clone());
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Token on Kindle");
}
