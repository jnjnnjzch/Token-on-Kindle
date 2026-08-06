from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one exact match, found {count}')
    write(path, text.replace(old, new, 1))


lib_path = Path('src-tauri/src/lib.rs')
lib = lib_path.read_text(encoding='utf-8')

replace_import = '''    sync::{Arc, Condvar, Mutex, RwLock},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
'''
new_import = '''    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex, RwLock,
    },
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
'''
if lib.count(replace_import) != 1:
    raise SystemExit('lib.rs: import anchor changed')
lib = lib.replace(replace_import, new_import, 1)

const_anchor = '''const MAX_REFRESH_MINUTES: u64 = 24 * 60;
'''
const_new = '''const MAX_REFRESH_MINUTES: u64 = 24 * 60;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const REFRESH_MIN_GAP_MS: u64 = 12_000;
'''
if lib.count(const_anchor) != 1:
    raise SystemExit('lib.rs: refresh constant anchor changed')
lib = lib.replace(const_anchor, const_new, 1)

old_summary = '''#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshSummary {
    refreshed: Vec<String>,
    failed: Vec<String>,
}
'''
new_summary = '''#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshSummary {
    requested_at: Option<String>,
    expected: Vec<String>,
    refreshed: Vec<String>,
    started: Vec<String>,
    pending: Vec<String>,
    failed: Vec<String>,
    already_running: bool,
}
'''
if lib.count(old_summary) != 1:
    raise SystemExit('lib.rs: RefreshSummary anchor changed')
lib = lib.replace(old_summary, new_summary, 1)

runtime_anchor = '''struct RefreshClock {
    minutes: Mutex<u64>,
    changed: Condvar,
}
'''
runtime_block = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Default)]
struct SourceRuntime {
    last_refresh_started_ms: AtomicU64,
    codex_creating: AtomicBool,
    deepseek_creating: AtomicBool,
    volcengine_creating: AtomicBool,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl SourceRuntime {
    fn creation_flag(&self, source: &str) -> Result<&AtomicBool, String> {
        match source {
            "codex" => Ok(&self.codex_creating),
            "deepseek" => Ok(&self.deepseek_creating),
            "volcengine" => Ok(&self.volcengine_creating),
            _ => Err("未知数据源".into()),
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct CreationClaim<'a> {
    flag: &'a AtomicBool,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl Drop for CreationClaim<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn claim_creation(flag: &AtomicBool) -> Option<CreationClaim<'_>> {
    flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .ok()
        .map(|_| CreationClaim { flag })
}

fn unix_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn try_claim_refresh(slot: &AtomicU64, now_ms: u64) -> bool {
    loop {
        let previous = slot.load(Ordering::Acquire);
        if previous != 0
            && now_ms >= previous
            && now_ms.saturating_sub(previous) < REFRESH_MIN_GAP_MS
        {
            return false;
        }
        if slot
            .compare_exchange(previous, now_ms, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return true;
        }
    }
}

struct RefreshClock {
    minutes: Mutex<u64>,
    changed: Condvar,
}
'''
if lib.count(runtime_anchor) != 1:
    raise SystemExit('lib.rs: RefreshClock anchor changed')
lib = lib.replace(runtime_anchor, runtime_block, 1)

app_state_old = '''struct AppState {
    metrics: Mutex<MetricsState>,
    png: Arc<RwLock<Vec<u8>>>,
    refresh: Arc<RefreshClock>,
    port: u16,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    mobile_refresh: Mutex<bool>,
}
'''
app_state_new = '''struct AppState {
    metrics: Mutex<MetricsState>,
    png: Arc<RwLock<Vec<u8>>>,
    refresh: Arc<RefreshClock>,
    port: u16,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    source_runtime: SourceRuntime,
    #[cfg(any(target_os = "android", target_os = "ios"))]
    mobile_refresh: Mutex<bool>,
}
'''
if lib.count(app_state_old) != 1:
    raise SystemExit('lib.rs: AppState anchor changed')
lib = lib.replace(app_state_old, app_state_new, 1)

block_start = lib.index('#[cfg(not(any(target_os = "android", target_os = "ios")))]\nfn create_source_window')
block_end = lib.index('\n#[cfg(any(target_os = "android", target_os = "ios"))]\nfn reload_sources', block_start)
new_source_block = r'''#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Clone)]
struct InitialSync {
    refresh_minutes: u64,
    requested_at: Option<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
enum SourceWindowState {
    Existing(WebviewWindow),
    Created(WebviewWindow),
    Starting,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn source_host_matches(source: &str, host: &str) -> bool {
    match source {
        "codex" => host == "chatgpt.com",
        "deepseek" => host.ends_with("deepseek.com"),
        "volcengine" => host.ends_with("volcengine.com"),
        _ => false,
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn sync_hook_script(refresh_minutes: u64, requested_at: Option<&str>) -> String {
    let requested_at = requested_at
        .map(|value| format!(", syncRequestedAt: \"{value}\""))
        .unwrap_or_default();
    format!(
        r#"(() => {{
          const options = {{ automatic: true, refreshMinutes: {refresh_minutes}{requested_at} }};
          const deadline = Date.now() + 15000;
          const run = () => {{
            if (typeof window.__TOKEN_ON_KINDLE_SYNC__ === 'function') {{
              Promise.resolve(window.__TOKEN_ON_KINDLE_SYNC__(options)).catch(error => console.error('[Token on Kindle] background sync failed', error));
              return;
            }}
            if (Date.now() < deadline) setTimeout(run, 250);
          }};
          run();
        }})()"#
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn create_source_window(
    app: &AppHandle,
    source: &str,
    initial_sync: InitialSync,
) -> tauri::Result<()> {
    let (label, title, url) = match source {
        "codex" => ("codex-login", "Codex Analytics", CODEX_URL),
        "deepseek" => ("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL),
        "volcengine" => (
            "volcengine-login",
            "火山方舟 Agent Plan 企业版",
            VOLCENGINE_URL,
        ),
        _ => unreachable!("only static sources are created"),
    };
    let parsed = url.parse().expect("static source URL must be valid");
    let pending_sync = Arc::new(Mutex::new(Some(initial_sync)));
    let pending_sync_on_load = Arc::clone(&pending_sync);
    let source_on_load = source.to_string();

    WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(1180.0, 820.0)
        .visible(false)
        .initialization_script(EXTRACTOR_SCRIPT)
        .on_page_load(move |window, payload| {
            if !matches!(payload.event(), PageLoadEvent::Finished) {
                return;
            }
            let host = payload.url().host_str().unwrap_or_default();
            if !source_host_matches(&source_on_load, host) {
                return;
            }
            let context = pending_sync_on_load
                .lock()
                .ok()
                .and_then(|mut value| value.take());
            let Some(context) = context else {
                return;
            };
            let script = sync_hook_script(
                context.refresh_minutes,
                context.requested_at.as_deref(),
            );
            if let Err(error) = window.eval(&script) {
                eprintln!("initial source sync injection failed for {source_on_load}: {error}");
            }
        })
        .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
        .build()?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn ensure_source_window(
    app: &AppHandle,
    source: &str,
    initial_sync: InitialSync,
) -> Result<SourceWindowState, String> {
    let (label, _, _) = source_url(source)?;
    if let Some(window) = app.get_webview_window(label) {
        return Ok(SourceWindowState::Existing(window));
    }

    let state = app.state::<AppState>();
    let flag = state.source_runtime.creation_flag(source)?;
    let Some(_claim) = claim_creation(flag) else {
        return Ok(SourceWindowState::Starting);
    };
    if let Some(window) = app.get_webview_window(label) {
        return Ok(SourceWindowState::Existing(window));
    }

    create_source_window(app, source, initial_sync)
        .map_err(|error| format!("无法创建 {label} 数据源窗口：{error}"))?;
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} 数据源窗口创建后不可用"))?;
    let _ = window.hide();
    Ok(SourceWindowState::Created(window))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn wait_for_source_window(app: &AppHandle, source: &str) -> Result<WebviewWindow, String> {
    let (label, _, _) = source_url(source)?;
    for _ in 0..60 {
        if let Some(window) = app.get_webview_window(label) {
            return Ok(window);
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!("{label} 数据源窗口启动超时"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
    let refresh_minutes = app.state::<AppState>().refresh.get();
    let initial_sync = InitialSync {
        refresh_minutes,
        requested_at: None,
    };
    let window = match ensure_source_window(app, source, initial_sync)? {
        SourceWindowState::Existing(window) | SourceWindowState::Created(window) => window,
        SourceWindowState::Starting => wait_for_source_window(app, source)?,
    };
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
fn background_refresh_window(
    window: &WebviewWindow,
    reload_page: bool,
    refresh_minutes: u64,
    sync_requested_at: &str,
) -> Result<(), String> {
    let sync_script = sync_hook_script(refresh_minutes, Some(sync_requested_at));
    if window.is_focused().unwrap_or(false) {
        return window.eval(&sync_script).map_err(|error| error.to_string());
    }

    let _ = window.hide();
    if reload_page {
        let reload_script = format!(
            "sessionStorage.setItem('__token_on_kindle_refresh_minutes', '{refresh_minutes}');sessionStorage.setItem('__token_on_kindle_sync_requested_at', '{sync_requested_at}');window.blur();location.reload()"
        );
        window
            .eval(&reload_script)
            .map_err(|error| error.to_string())?;
    } else {
        window
            .eval(&sync_script)
            .map_err(|error| error.to_string())?;
    }
    let _ = window.hide();
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn schedule_follow_up_refresh(
    app: AppHandle,
    source: &'static str,
    source_name: &'static str,
    reload_page: bool,
    refresh_minutes: u64,
    sync_requested_at: String,
) {
    thread::spawn(move || {
        let (label, _, _) = match source_url(source) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("follow-up refresh rejected for {source_name}: {error}");
                return;
            }
        };
        for _ in 0..60 {
            if let Some(window) = app.get_webview_window(label) {
                thread::sleep(Duration::from_millis(1800));
                if let Err(error) = background_refresh_window(
                    &window,
                    reload_page,
                    refresh_minutes,
                    &sync_requested_at,
                ) {
                    eprintln!("follow-up refresh failed for {source_name}: {error}");
                }
                return;
            }
            thread::sleep(Duration::from_millis(250));
        }
        eprintln!("follow-up refresh timed out for {source_name}");
    });
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn start_source_warmup(app: AppHandle) {
    for (source, delay_ms) in [
        ("codex", 700_u64),
        ("deepseek", 1100_u64),
        ("volcengine", 1500_u64),
    ] {
        let app = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(delay_ms));
            let refresh_minutes = app.state::<AppState>().refresh.get();
            let initial_sync = InitialSync {
                refresh_minutes,
                requested_at: None,
            };
            if let Err(error) = ensure_source_window(&app, source, initial_sync) {
                eprintln!("source window warm-up failed for {source}: {error}");
            }
        });
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reload_sources(app: &AppHandle) -> Result<RefreshSummary, String> {
    let state = app.state::<AppState>();
    let now_ms = unix_millis();
    if !try_claim_refresh(&state.source_runtime.last_refresh_started_ms, now_ms) {
        return Ok(RefreshSummary {
            requested_at: None,
            expected: Vec::new(),
            refreshed: Vec::new(),
            started: Vec::new(),
            pending: Vec::new(),
            failed: Vec::new(),
            already_running: true,
        });
    }

    let refresh_minutes = state.refresh.get();
    let sync_requested_at = now_ms.to_string();
    let mut expected = Vec::new();
    let mut refreshed = Vec::new();
    let mut started = Vec::new();
    let mut pending = Vec::new();
    let mut failed = Vec::new();

    for (source, source_name, reload_page) in [
        ("codex", "Codex", true),
        ("deepseek", "DeepSeek", true),
        ("volcengine", "火山方舟", false),
    ] {
        let initial_sync = InitialSync {
            refresh_minutes,
            requested_at: Some(sync_requested_at.clone()),
        };
        match ensure_source_window(app, source, initial_sync) {
            Ok(SourceWindowState::Existing(window)) => {
                match background_refresh_window(
                    &window,
                    reload_page,
                    refresh_minutes,
                    &sync_requested_at,
                ) {
                    Ok(()) => {
                        expected.push(source.to_string());
                        refreshed.push(source_name.to_string());
                    }
                    Err(error) => failed.push(format!("{source_name}：{error}")),
                }
            }
            Ok(SourceWindowState::Created(window)) => {
                let _ = window.hide();
                expected.push(source.to_string());
                started.push(source_name.to_string());
            }
            Ok(SourceWindowState::Starting) => {
                expected.push(source.to_string());
                pending.push(source_name.to_string());
                schedule_follow_up_refresh(
                    app.clone(),
                    source,
                    source_name,
                    reload_page,
                    refresh_minutes,
                    sync_requested_at.clone(),
                );
            }
            Err(error) => failed.push(format!("{source_name}：{error}")),
        }
    }

    if expected.is_empty() {
        state
            .source_runtime
            .last_refresh_started_ms
            .store(0, Ordering::Release);
    }
    if !failed.is_empty() {
        eprintln!("partial source refresh failure: {}", failed.join(" | "));
    }
    Ok(RefreshSummary {
        requested_at: Some(sync_requested_at),
        expected,
        refreshed,
        started,
        pending,
        failed,
        already_running: false,
    })
}
'''
lib = lib[:block_start] + new_source_block + lib[block_end:]

mobile_old = '''    Ok(RefreshSummary {
        refreshed: vec!["移动端采集".into()],
        failed: Vec::new(),
    })
'''
mobile_new = '''    Ok(RefreshSummary {
        requested_at: Some(unix_millis().to_string()),
        expected: vec!["codex".into(), "deepseek".into(), "volcengine".into()],
        refreshed: vec!["移动端采集".into()],
        started: Vec::new(),
        pending: Vec::new(),
        failed: Vec::new(),
        already_running: false,
    })
'''
if lib.count(mobile_old) != 1:
    raise SystemExit('lib.rs: mobile RefreshSummary anchor changed')
lib = lib.replace(mobile_old, mobile_new, 1)

state_init_old = '''            refresh: Arc::clone(&refresh),
            port,
            #[cfg(any(target_os = "android", target_os = "ios"))]
            mobile_refresh: Mutex::new(false),
'''
state_init_new = '''            refresh: Arc::clone(&refresh),
            port,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            source_runtime: SourceRuntime::default(),
            #[cfg(any(target_os = "android", target_os = "ios"))]
            mobile_refresh: Mutex::new(false),
'''
if lib.count(state_init_old) != 1:
    raise SystemExit('lib.rs: AppState initialization anchor changed')
lib = lib.replace(state_init_old, state_init_new, 1)

setup_old = '''            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            for source in ["codex", "deepseek", "volcengine"] {
                if let Err(error) = create_source_window(app.handle(), source) {
                    eprintln!("source window warm-up failed for {source}: {error}");
                }
            }

            start_refresh_scheduler(app.handle().clone(), Arc::clone(&refresh));
'''
setup_new = '''            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            start_source_warmup(app.handle().clone());

            start_refresh_scheduler(app.handle().clone(), Arc::clone(&refresh));
'''
if lib.count(setup_old) != 1:
    raise SystemExit('lib.rs: synchronous warm-up anchor changed')
lib = lib.replace(setup_old, setup_new, 1)

tests_block = r'''

#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod source_runtime_tests {
    use super::*;

    #[test]
    fn refresh_claim_enforces_native_single_flight_gap() {
        let slot = AtomicU64::new(0);
        assert!(try_claim_refresh(&slot, 100_000));
        assert!(!try_claim_refresh(
            &slot,
            100_000 + REFRESH_MIN_GAP_MS - 1
        ));
        assert!(try_claim_refresh(&slot, 100_000 + REFRESH_MIN_GAP_MS));
    }

    #[test]
    fn creation_claim_is_per_source_and_releases_on_drop() {
        let flag = AtomicBool::new(false);
        let claim = claim_creation(&flag).expect("first source creator should win");
        assert!(claim_creation(&flag).is_none());
        drop(claim);
        assert!(claim_creation(&flag).is_some());
    }

    #[test]
    fn source_page_load_matching_rejects_cross_origin_redirects() {
        assert!(source_host_matches("codex", "chatgpt.com"));
        assert!(source_host_matches("deepseek", "platform.deepseek.com"));
        assert!(source_host_matches("volcengine", "console.volcengine.com"));
        assert!(!source_host_matches("codex", "auth.openai.com"));
        assert!(!source_host_matches("volcengine", "example.com"));
    }
}
'''
if 'mod source_runtime_tests' in lib:
    raise SystemExit('lib.rs: source runtime tests already exist')
lib = lib.rstrip() + tests_block + '\n'
lib_path.write_text(lib, encoding='utf-8')

app_path = Path('web/app.js')
app = app_path.read_text(encoding='utf-8')
app = app.replace(
    'const REFRESH_COMMAND_TIMEOUT_MS = 15_000;\n',
    'const REFRESH_COMMAND_TIMEOUT_MS = 15_000;\nconst REFRESH_RECEIPT_TIMEOUT_MS = 20_000;\n',
    1,
)
app = app.replace(
    'let refreshInFlight = false;\n',
    'let refreshInFlight = false;\nlet activeRefresh = null;\nlet refreshReceiptTimer = null;\n',
    1,
)

listener_old = '''  await listen('metrics-updated', event => {
    state = { ...event.payload, refreshMinutes: state.refreshMinutes };
    document.querySelector('#service').textContent = serviceDescription('已收到最新数据');
    updateUi();
  });
}
'''
listener_new = '''  await listen('metrics-updated', event => {
    state = { ...event.payload, refreshMinutes: state.refreshMinutes };
    const refreshStatus = reconcileRefreshReceipt();
    document.querySelector('#service').textContent = refreshStatus || serviceDescription('已收到最新数据');
    updateUi();
  });
}
'''
if app.count(listener_old) != 1:
    raise SystemExit('app.js: metrics listener anchor changed')
app = app.replace(listener_old, listener_new, 1)

refresh_anchor = '''async function invokeRefreshSources() {
'''
refresh_helpers = '''function sourceName(source) {
  return SOURCES.find(item => item.id === source)?.name || source;
}

function clearRefreshReceipt() {
  if (refreshReceiptTimer) clearTimeout(refreshReceiptTimer);
  refreshReceiptTimer = null;
  activeRefresh = null;
}

function reconcileRefreshReceipt() {
  if (!activeRefresh) return null;
  activeRefresh.pending = activeRefresh.pending.filter(source =>
    String(state[source]?.syncRequestedAt || '') !== activeRefresh.requestedAt
  );
  const returned = activeRefresh.expected.filter(source => !activeRefresh.pending.includes(source));
  if (!activeRefresh.pending.length) {
    clearRefreshReceipt();
    return serviceDescription('本轮后台同步完成');
  }
  return serviceDescription(returned.length
    ? `已返回 ${returned.map(sourceName).join('、')}；等待 ${activeRefresh.pending.map(sourceName).join('、')}`
    : `等待 ${activeRefresh.pending.map(sourceName).join('、')} 返回`);
}

function beginRefreshReceipt(result) {
  if (result?.alreadyRunning) return null;
  const requestedAt = String(result?.requestedAt || '');
  const expected = [...new Set((Array.isArray(result?.expected) ? result.expected : [])
    .filter(source => SOURCES.some(item => item.id === source)))];
  if (!requestedAt || !expected.length) return null;

  clearRefreshReceipt();
  activeRefresh = { requestedAt, expected, pending: [...expected] };
  const immediate = reconcileRefreshReceipt();
  if (!activeRefresh) return immediate;
  refreshReceiptTimer = setTimeout(() => {
    const pending = activeRefresh?.pending || [];
    clearRefreshReceipt();
    if (pending.length) {
      document.querySelector('#service').textContent = serviceDescription(
        `20 秒内未返回：${pending.map(sourceName).join('、')}；后台仍会继续尝试`
      );
    }
  }, REFRESH_RECEIPT_TIMEOUT_MS);
  return null;
}

function refreshTriggerDescription(result) {
  if (result?.alreadyRunning) return serviceDescription('已有刷新批次正在执行');
  const parts = [];
  const refreshed = Array.isArray(result?.refreshed) ? result.refreshed : [];
  const started = Array.isArray(result?.started) ? result.started : [];
  const pending = Array.isArray(result?.pending) ? result.pending : [];
  const failed = Array.isArray(result?.failed) ? result.failed : [];
  if (refreshed.length) parts.push(`已触发 ${refreshed.join('、')}`);
  if (started.length) parts.push(`已自动启动 ${started.join('、')}`);
  if (pending.length) parts.push(`正在等待 ${pending.join('、')} 窗口启动`);
  if (failed.length) parts.push(`失败：${failed.join('；')}`);
  if (!parts.length) parts.push('刷新请求已提交');
  return serviceDescription(parts.join('；'));
}

async function invokeRefreshSources() {
'''
if app.count(refresh_anchor) != 1:
    raise SystemExit('app.js: invokeRefreshSources anchor changed')
app = app.replace(refresh_anchor, refresh_helpers, 1)

refresh_old = '''    const result = await invokeRefreshSources();
    const failed = Array.isArray(result?.failed) ? result.failed : [];
    document.querySelector('#service').textContent = failed.length
      ? serviceDescription(`已触发其余来源；${failed.join('；')}`)
      : serviceDescription('已触发刷新，等待页面返回');
'''
refresh_new = '''    const result = await invokeRefreshSources();
    const immediateReceipt = beginRefreshReceipt(result);
    document.querySelector('#service').textContent = immediateReceipt || refreshTriggerDescription(result);
'''
if app.count(refresh_old) != 1:
    raise SystemExit('app.js: refresh result anchor changed')
app = app.replace(refresh_old, refresh_new, 1)
app_path.write_text(app, encoding='utf-8')

# Replace the focused regression tests with the audited runtime contract.
background = Path('tests/background-refresh-v097.test.mjs')
background.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const deepseek = fs.readFileSync(new URL('../web/deepseek-direct-reader.js', import.meta.url), 'utf8');
const volcengine = fs.readFileSync(new URL('../web/volcengine-chart-reader.js', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');

const setup = rust.slice(rust.indexOf('.setup(move |app|'), rust.indexOf('.on_window_event', rust.indexOf('.setup(move |app|')));
const refreshStart = rust.indexOf('fn reload_sources(app: &AppHandle)');
const refreshEnd = rust.indexOf('#[cfg(any(target_os = "android"', refreshStart);
const refresh = rust.slice(refreshStart, refreshEnd);

test('dashboard setup returns without synchronously constructing external WebViews', () => {
  assert.match(setup, /start_source_warmup\(app\.handle\(\)\.clone\(\)\)/);
  assert.doesNotMatch(setup, /create_source_window/);
  assert.match(rust, /fn start_source_warmup\(app: AppHandle\)/);
  assert.match(rust, /thread::spawn\(move \|\|/);
  assert.match(rust, /\("codex", 700_u64\)/);
  assert.match(rust, /\("deepseek", 1100_u64\)/);
  assert.match(rust, /\("volcengine", 1500_u64\)/);
});

test('window creation is independently serialized and auto-syncs after a matching page load', () => {
  assert.match(rust, /struct SourceRuntime/);
  assert.match(rust, /codex_creating: AtomicBool/);
  assert.match(rust, /deepseek_creating: AtomicBool/);
  assert.match(rust, /volcengine_creating: AtomicBool/);
  assert.match(rust, /claim_creation\(flag\)/);
  assert.match(rust, /SourceWindowState::Starting/);
  assert.match(rust, /on_page_load\(move \|window, payload\|/);
  assert.match(rust, /PageLoadEvent::Finished/);
  assert.match(rust, /source_host_matches/);
  assert.match(rust, /sync_hook_script/);
});

test('manual, tray, and scheduled refresh share a native single-flight batch', () => {
  assert.match(rust, /REFRESH_MIN_GAP_MS: u64 = 12_000/);
  assert.match(refresh, /try_claim_refresh/);
  assert.match(refresh, /already_running: true/);
  assert.match(refresh, /expected\.push\(source\.to_string\(\)\)/);
  assert.match(refresh, /started\.push\(source_name\.to_string\(\)\)/);
  assert.match(refresh, /pending\.push\(source_name\.to_string\(\)\)/);
  assert.match(refresh, /schedule_follow_up_refresh/);
  assert.doesNotMatch(refresh, /后台窗口不存在/);
});

test('control center releases the button and reports actual batch receipts', () => {
  assert.match(app, /REFRESH_COMMAND_TIMEOUT_MS = 15_000/);
  assert.match(app, /REFRESH_RECEIPT_TIMEOUT_MS = 20_000/);
  assert.match(app, /beginRefreshReceipt\(result\)/);
  assert.match(app, /state\[source\]\?\.syncRequestedAt/);
  assert.match(app, /本轮后台同步完成/);
  assert.match(app, /20 秒内未返回/);
  assert.match(app, /后台仍会继续尝试/);
});

test('all generated source readers autonomously collect after hidden-window startup', () => {
  assert.match(deepseek, /1800/);
  assert.match(deepseek, /5200/);
  assert.match(volcengine, /\[1200, 3200, 6500\]/);
  assert.match(rust, /setTimeout\(run, 250\)/);
});

test('persistent pipeline runs Rust source-runtime tests on Linux', () => {
  assert.match(workflow, /cargo test --manifest-path src-tauri\/Cargo\.toml --lib/);
});
''', encoding='utf-8')

startup = Path('tests/main-window-startup-v096.test.mjs')
text = startup.read_text(encoding='utf-8')
start = text.index("test('main window starts first")
end = text.index("test('dashboard PNG", start)
replacement = r'''test('main window starts first and provider warm-up is detached and non-fatal', () => {
  assert.match(rust, /fn ensure_source_window\(/);
  assert.match(setup, /start_source_warmup\(app\.handle\(\)\.clone\(\)\)/);
  assert.doesNotMatch(setup, /create_source_window/);
  assert.doesNotMatch(setup, /initialization_script\(EXTRACTOR_SCRIPT\)/);
  assert.equal((rust.match(/\.initialization_script\(EXTRACTOR_SCRIPT\)/g) || []).length, 1);
  assert.match(rust, /source window warm-up failed for \{source\}/);
});

test('manual and scheduled refresh recreate or follow up every provider window', () => {
  const refresh = rust.slice(rust.indexOf('fn reload_sources(app: &AppHandle)'), rust.indexOf('#[cfg(any(target_os = "android"', rust.indexOf('fn reload_sources(app: &AppHandle)')));
  assert.match(refresh, /ensure_source_window\(app, source, initial_sync\)/);
  assert.match(refresh, /\("codex", "Codex", true\)/);
  assert.match(refresh, /\("deepseek", "DeepSeek", true\)/);
  assert.match(refresh, /\("volcengine", "火山方舟", false\)/);
  assert.match(refresh, /SourceWindowState::Created/);
  assert.match(refresh, /SourceWindowState::Starting/);
  assert.match(refresh, /schedule_follow_up_refresh/);
});

'''
startup.write_text(text[:start] + replacement + text[end:], encoding='utf-8')

long_running = Path('tests/long-running-sync-v095.test.mjs')
text = long_running.read_text(encoding='utf-8')
text = text.replace(
    '  assert.match(rust, /Ok\\(RefreshSummary \\{ refreshed, failed \\}\\)/);\n',
    '  assert.match(rust, /requested_at: Some\\(sync_requested_at\\)/);\n  assert.match(rust, /already_running: false/);\n',
    1,
)
text = text.replace(
    "  assert.match(app, /result\\?\\.failed/);\n  assert.match(app, /已触发其余来源/);\n",
    "  assert.match(app, /result\\?\\.failed/);\n  assert.match(app, /失败：/);\n  assert.match(app, /20 秒内未返回/);\n",
    1,
)
long_running.write_text(text, encoding='utf-8')

pipeline = Path('.github/workflows/pipeline.yml')
text = pipeline.read_text(encoding='utf-8')
pipeline_anchor = '''      - name: Install dependencies
        run: npm install
      - name: Compile desktop application
'''
pipeline_new = '''      - name: Install dependencies
        run: npm install
      - name: Run Rust source-runtime tests
        if: runner.os == 'Linux'
        run: cargo test --manifest-path src-tauri/Cargo.toml --lib
      - name: Compile desktop application
'''
if text.count(pipeline_anchor) != 1:
    raise SystemExit('pipeline.yml: desktop install anchor changed')
pipeline.write_text(text.replace(pipeline_anchor, pipeline_new, 1), encoding='utf-8')

readme = Path('README.md')
text = readme.read_text(encoding='utf-8')
old_section = '''## v0.9.7 后台刷新回归修复

- 恢复 v0.6.2 的隐藏数据源预热思路，但任何单个 WebView 创建失败都不会终止主界面。
- 定时刷新和“立即刷新”会自动创建缺失的 Codex、DeepSeek、火山方舟窗口，不再要求先手动点击卡片。
- 新建窗口会依靠采集脚本自动同步；已有窗口继续执行来源专用刷新逻辑。
- “立即刷新”增加 15 秒界面保护，原生命令异常时按钮也不会永久转圈。
'''
new_section = '''## v0.9.7 后台刷新回归修复

- 主窗口完成创建后立即结束 `setup`；Codex、DeepSeek、火山方舟由三个错峰独立线程预热，任一外部 WebView 失败或卡住都不影响主界面和其他来源。
- 启动预热、卡片点击、定时刷新和“立即刷新”共享每来源创建锁；缺失窗口会自动补建，正在创建的窗口会安排后续刷新，不再要求先手动点击卡片。
- 原生层对按钮、托盘和定时器实行 12 秒刷新单飞；Codex/DeepSeek 重新载入，火山方舟只调用当前企业版 SPA 页面内同步并保留视图。
- 每轮刷新携带唯一批次 ID；控制中心依据来源实际返回显示“已返回/仍等待”，原生命令 15 秒解锁，20 秒未返回会列出具体来源但后台继续尝试。
- 火山方舟首次登录仍需进入 Agent Plan 企业版“用量统计”；识别到 AFP 页面后会自动同步，以后隐藏窗口保持该页面状态。
'''
if text.count(old_section) != 1:
    raise SystemExit('README.md: v0.9.7 section changed')
readme.write_text(text.replace(old_section, new_section, 1), encoding='utf-8')

doc = Path('docs/v0.9.7.md')
doc.write_text('''# v0.9.7

## 根因

v0.9.6 为避免外部 WebView 创建失败终止主程序，把三个数据源改成首次点击时创建，但定时刷新和“立即刷新”仍假设窗口已经存在。因此冷启动后后台无法采集，用户必须逐个打开数据源并手动同步。

## 修复架构

- Tauri `setup` 只创建本地主窗口并启动非阻塞预热调度，不再同步创建外部 WebView。
- Codex、DeepSeek、火山方舟分别在错峰独立线程中创建；每来源原子创建锁避免预热、点击和刷新重复创建同标签窗口。
- 缺失窗口由刷新自动补建；窗口正在创建时安排后续刷新，不把“正在启动”当成同步成功。
- 原生层以 12 秒间隔合并按钮、托盘和定时器刷新，避免页面连续 reload。
- 新建窗口在匹配来源域名的首次页面加载完成后注入一次同步请求；已有 Codex/DeepSeek 窗口 reload，火山窗口只调用页面内同步以保留 SPA 状态。
- 控制中心用 `syncRequestedAt` 批次 ID 核对实际返回：15 秒仅限制原生命令等待，20 秒收集窗口后列出未返回来源，后台任务不会因此取消。

## 验证

- 完整 JavaScript、解析器、渲染器、工作流与刷新契约测试。
- Rust 原生单飞、每来源创建锁和域名匹配单元测试。
- Windows、macOS、Linux、Android 实际构建。
''', encoding='utf-8')
