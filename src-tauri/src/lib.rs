use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Condvar, Mutex, RwLock},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

mod desktop;
mod update_helper;

pub fn run_update_helper_from_args() -> bool {
    update_helper::run_from_args()
}
use desktop::{
    copy_browser_url, get_desktop_state, open_browser_url, set_autostart_enabled,
    set_collection_paused, set_tray_source_status, set_tray_update_status,
};

const EXTRACTOR_SCRIPT: &str = include_str!("../../web/extractor.js");
const CODEX_URL: &str = "https://chatgpt.com/codex/cloud/settings/analytics";
const DEEPSEEK_URL: &str = "https://platform.deepseek.com/usage";
const VOLCENGINE_URL: &str = "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan-enterprise";
const SIGNAL_PREFIX: &str = "__TOKEN_ON_KINDLE__:";
const ACTION_PREFIX: &str = "__TOKEN_ON_KINDLE_ACTION__:";
const DEFAULT_REFRESH_MINUTES: u64 = 10;
const MIN_REFRESH_MINUTES: u64 = 1;
const MAX_REFRESH_MINUTES: u64 = 24 * 60;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetricsState {
    codex: Option<Value>,
    deepseek: Option<Value>,
    volcengine: Option<Value>,
    received_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettings {
    refresh_minutes: u64,
    image_url: String,
    browser_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRequest {
    version: String,
    download_url: String,
    checksum_url: String,
    asset_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstallResult {
    version: String,
    restarting: bool,
}

struct RefreshClock {
    minutes: Mutex<u64>,
    changed: Condvar,
}

impl RefreshClock {
    fn new(minutes: u64) -> Self {
        Self {
            minutes: Mutex::new(minutes),
            changed: Condvar::new(),
        }
    }

    fn get(&self) -> u64 {
        self.minutes
            .lock()
            .map(|minutes| *minutes)
            .unwrap_or(DEFAULT_REFRESH_MINUTES)
    }

    fn set(&self, minutes: u64) -> Result<u64, String> {
        if !(MIN_REFRESH_MINUTES..=MAX_REFRESH_MINUTES).contains(&minutes) {
            return Err(format!(
                "刷新间隔必须在 {MIN_REFRESH_MINUTES}–{MAX_REFRESH_MINUTES} 分钟之间"
            ));
        }
        let mut current = self
            .minutes
            .lock()
            .map_err(|_| "刷新计时器锁已损坏")?;
        *current = minutes;
        self.changed.notify_all();
        Ok(minutes)
    }
}

struct AppState {
    metrics: Mutex<MetricsState>,
    png: Arc<RwLock<Vec<u8>>>,
    refresh: Arc<RefreshClock>,
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

fn runtime_settings(state: &AppState) -> RuntimeSettings {
    let host = local_ip();
    RuntimeSettings {
        refresh_minutes: state.refresh.get(),
        image_url: format!("http://{host}:{}/dashboard.png", state.port),
        browser_url: format!("http://{host}:{}/", state.port),
    }
}

#[tauri::command]
fn get_runtime_settings(state: State<'_, AppState>) -> RuntimeSettings {
    runtime_settings(&state)
}

#[tauri::command]
fn get_dashboard_url(state: State<'_, AppState>) -> String {
    runtime_settings(&state).image_url
}

#[tauri::command]
fn get_browser_url(state: State<'_, AppState>) -> String {
    runtime_settings(&state).browser_url
}

#[tauri::command]
fn set_refresh_interval(
    minutes: u64,
    state: State<'_, AppState>,
) -> Result<RuntimeSettings, String> {
    state.refresh.set(minutes)?;
    Ok(runtime_settings(&state))
}

fn source_url(source: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match source {
        "codex" => Ok(("codex-login", "Codex Analytics", CODEX_URL)),
        "deepseek" => Ok(("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL)),
        "volcengine" => Ok(("volcengine-login", "火山方舟 Agent Plan 企业版", VOLCENGINE_URL)),
        _ => Err("未知数据源".into()),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn create_source_window(app: &tauri::App, source: &str) -> tauri::Result<()> {
    let (label, title, url) = match source {
        "codex" => ("codex-login", "Codex Analytics", CODEX_URL),
        "deepseek" => ("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL),
        "volcengine" => ("volcengine-login", "火山方舟 Agent Plan 企业版", VOLCENGINE_URL),
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
fn background_refresh_window(window: &WebviewWindow, reload_page: bool) -> Result<(), String> {
    if window.is_focused().unwrap_or(false) {
        return window
            .eval("window.__TOKEN_ON_KINDLE_SYNC__?.({ automatic: true })")
            .map_err(|error| error.to_string());
    }

    let _ = window.hide();
    let script = if reload_page {
        "window.blur(); location.reload()"
    } else {
        "window.blur(); window.__TOKEN_ON_KINDLE_SYNC__?.({ automatic: true })"
    };
    window.eval(script).map_err(|error| error.to_string())?;
    let _ = window.hide();
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reload_sources(app: &AppHandle) -> Result<(), String> {
    let mut refreshed = 0;
    for label in ["codex-login", "deepseek-login"] {
        if let Some(window) = app.get_webview_window(label) {
            background_refresh_window(&window, true)?;
            refreshed += 1;
        }
    }
    if let Some(window) = app.get_webview_window("volcengine-login") {
        background_refresh_window(&window, false)?;
        refreshed += 1;
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

fn validate_update_request(request: &UpdateRequest) -> Result<(), String> {
    const RELEASE_PREFIX: &str = "https://github.com/jnjnnjzch/Token-on-Kindle/releases/download/";
    if !request.download_url.starts_with(RELEASE_PREFIX)
        || !request.checksum_url.starts_with(RELEASE_PREFIX)
    {
        return Err("更新地址不是本项目的 GitHub Release".into());
    }
    if !request.asset_name.starts_with("Token-on-Kindle-")
        || !request.asset_name.ends_with("-windows-x64.zip")
        || request.asset_name.contains('/')
        || request.asset_name.contains('\\')
    {
        return Err("Windows 更新包名称不合法".into());
    }
    if !request.checksum_url.ends_with("-SHA256SUMS.txt") {
        return Err("Release 缺少统一 SHA-256 校验文件".into());
    }
    let version = request.version.strip_prefix('v').unwrap_or(&request.version);
    if version.split('.').count() < 3
        || !version.chars().all(|character| {
            character.is_ascii_alphanumeric() || ".-_".contains(character)
        })
    {
        return Err("版本号格式不合法".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn find_update_executable(root: &Path) -> Option<PathBuf> {
    for entry in fs::read_dir(root).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_update_executable(&path) {
                return Some(found);
            }
        } else if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("Token-on-Kindle.exe"))
        {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn install_update(
    app: AppHandle,
    request: UpdateRequest,
) -> Result<UpdateInstallResult, String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    validate_update_request(&request)?;

    let current_exe = std::env::current_exe()
        .map_err(|error| format!("无法定位当前程序：{error}"))?;
    let temp_root = std::env::temp_dir().join(format!(
        "token-on-kindle-update-{}-{}",
        request.version.trim_start_matches('v'),
        timestamp()
    ));
    let extract_dir = temp_root.join("payload");
    let zip_path = temp_root.join(&request.asset_name);
    let checksum_path = temp_root.join("SHA256SUMS.txt");
    fs::create_dir_all(&extract_dir)
        .map_err(|error| format!("无法创建更新目录：{error}"))?;

    let download_script = temp_root.join("download-and-verify.ps1");
    fs::write(
        &download_script,
        r#"param(
  [string]$DownloadUrl,
  [string]$ChecksumUrl,
  [string]$AssetName,
  [string]$ZipPath,
  [string]$ChecksumPath,
  [string]$ExtractDir
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing -Uri $DownloadUrl -OutFile $ZipPath
Invoke-WebRequest -UseBasicParsing -Uri $ChecksumUrl -OutFile $ChecksumPath
$line = Get-Content -LiteralPath $ChecksumPath | Where-Object { $_ -match ([regex]::Escape($AssetName) + '$') } | Select-Object -First 1
if (-not $line) { throw "checksum entry not found for $AssetName" }
$expected = ($line -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expected -ne $actual) { throw "SHA-256 mismatch: expected $expected, got $actual" }
Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir -Force
"#,
    )
    .map_err(|error| format!("无法写入下载脚本：{error}"))?;

    let output = Command::new("powershell.exe")
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&download_script)
        .arg("-DownloadUrl")
        .arg(&request.download_url)
        .arg("-ChecksumUrl")
        .arg(&request.checksum_url)
        .arg("-AssetName")
        .arg(&request.asset_name)
        .arg("-ZipPath")
        .arg(&zip_path)
        .arg("-ChecksumPath")
        .arg(&checksum_path)
        .arg("-ExtractDir")
        .arg(&extract_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("无法启动 PowerShell 下载器：{error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "更新包下载或校验失败".into()
        } else {
            format!("更新包下载或校验失败：{detail}")
        });
    }

    let source_exe = find_update_executable(&extract_dir)
        .ok_or_else(|| "更新包中没有找到 Token-on-Kindle.exe".to_string())?;
    update_helper::prepare_and_spawn(&current_exe, &source_exe, &temp_root)?;

    let app_for_exit = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(900));
        app_for_exit.exit(0);
    });

    Ok(UpdateInstallResult {
        version: request.version,
        restarting: true,
    })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn install_update(
    _app: AppHandle,
    _request: UpdateRequest,
) -> Result<UpdateInstallResult, String> {
    Err("当前自动安装仅支持 Windows 便携版；请从 Release 下载对应平台版本".into())
}


fn start_refresh_scheduler(app: AppHandle, refresh: Arc<RefreshClock>) {
    thread::spawn(move || loop {
        let guard = match refresh.minutes.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let wait = Duration::from_secs((*guard).saturating_mul(60));
        let result = refresh.changed.wait_timeout(guard, wait);
        let Ok((_guard, timeout)) = result else {
            return;
        };
        if timeout.timed_out() && !desktop::is_paused(&app) {
            let _ = reload_sources(&app);
        }
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
            "volcengine" => metrics.volcengine = Some(payload),
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
                "deepseek" => {
                    if let Ok(url) = VOLCENGINE_URL.parse() {
                        let _ = window.navigate(url);
                    }
                }
                "volcengine" => return_to_dashboard(window),
                _ => {}
            }
        }
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    cache_control: &str,
) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: {cache_control}\r\nPragma: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn browser_page(refresh_minutes: u64) -> String {
    let refresh_seconds = refresh_minutes.saturating_mul(60);
    let nonce = timestamp();
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="refresh" content="{refresh_seconds}">
<title>Token on Kindle</title>
<style>
html,body{{margin:0;padding:0;background:#e7e7e7;color:#111}}
body{{font-family:Arial,"Microsoft YaHei",sans-serif}}
main{{width:100%;margin:0 auto}}
a{{display:block;color:inherit;text-decoration:none}}
img{{display:block;width:100%;height:auto;margin:0 auto;border:0;background:#fff}}
.notice{{padding:18px;text-align:center;font-size:18px;line-height:1.5}}
</style>
</head>
<body>
<main>
<a href="/" aria-label="点击立即刷新">
<img src="/dashboard.png?v={nonce}" alt="Codex、DeepSeek 与火山方舟用量看板">
</a>
<noscript><p class="notice">页面每 {refresh_minutes} 分钟自动重新载入；点击图片可立即刷新。</p></noscript>
</main>
</body>
</html>"#
    )
}

fn handle_client(
    mut stream: TcpStream,
    png: Arc<RwLock<Vec<u8>>>,
    refresh: Arc<RefreshClock>,
) {
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

    match path {
        "/dashboard.png" => {
            let bytes = png.read().map(|value| value.clone()).unwrap_or_default();
            if bytes.is_empty() {
                write_response(
                    &mut stream,
                    "503 Service Unavailable",
                    "text/plain; charset=utf-8",
                    b"dashboard has not been rendered yet",
                    "no-store",
                );
            } else {
                write_response(
                    &mut stream,
                    "200 OK",
                    "image/png",
                    &bytes,
                    "no-store, no-cache, must-revalidate, max-age=0",
                );
            }
        }
        "/" | "/index.html" => {
            let body = browser_page(refresh.get());
            write_response(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                body.as_bytes(),
                "no-store, no-cache, must-revalidate, max-age=0",
            );
        }
        "/healthz" => {
            let ready = png.read().map(|value| !value.is_empty()).unwrap_or(false);
            let body = serde_json::json!({
                "ok": true,
                "dashboardReady": ready,
                "refreshMinutes": refresh.get()
            })
            .to_string();
            write_response(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                body.as_bytes(),
                "no-store",
            );
        }
        _ => write_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"not found",
            "no-store",
        ),
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

fn start_http_server(
    listener: TcpListener,
    png: Arc<RwLock<Vec<u8>>>,
    refresh: Arc<RefreshClock>,
) {
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let png = Arc::clone(&png);
            let refresh = Arc::clone(&refresh);
            thread::spawn(move || handle_client(stream, png, refresh));
        }
    });
}

#[cfg_attr(any(target_os = "android", target_os = "ios"), tauri::mobile_entry_point)]
pub fn run() {
    let (listener, port) = bind_http_server().expect("failed to bind local HTTP server");
    let png = Arc::new(RwLock::new(Vec::new()));
    let refresh = Arc::new(RefreshClock::new(DEFAULT_REFRESH_MINUTES));
    start_http_server(listener, Arc::clone(&png), Arc::clone(&refresh));

    tauri::Builder::default()
        .manage(desktop::DesktopState::default())
        .manage(AppState {
            metrics: Mutex::new(MetricsState::default()),
            png,
            refresh: Arc::clone(&refresh),
            port,
            #[cfg(any(target_os = "android", target_os = "ios"))]
            mobile_refresh: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            set_dashboard_png,
            get_status,
            get_runtime_settings,
            get_dashboard_url,
            get_browser_url,
            set_refresh_interval,
            open_source,
            refresh_sources,
            install_update,
            get_desktop_state,
            set_collection_paused,
            set_autostart_enabled,
            set_tray_source_status,
            set_tray_update_status,
            copy_browser_url,
            open_browser_url
        ])
        .setup(move |app| {
            desktop::init_plugins(app)?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Token on Kindle")
                .inner_size(1180.0, 820.0)
                .min_inner_size(820.0, 620.0)
                .initialization_script(EXTRACTOR_SCRIPT)
                .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
                .build()?;

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                create_source_window(app, "codex")?;
                create_source_window(app, "deepseek")?;
                create_source_window(app, "volcengine")?;
            }

            start_refresh_scheduler(app.handle().clone(), Arc::clone(&refresh));
            if let Err(error) = desktop::build_tray(app) {
                eprintln!("system tray unavailable: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| desktop::handle_window_event(window, event))
        .run(tauri::generate_context!())
        .expect("error while running Token on Kindle");
}
