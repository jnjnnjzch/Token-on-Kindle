from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


lib_path = Path('src-tauri/src/lib.rs')
lib = read(lib_path)

old_constants = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
const REFRESH_MIN_GAP_MS: u64 = 12_000;
'''
new_constants = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
const REFRESH_BATCH_TIMEOUT_MS: u64 = 30_000;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const CREATION_STALE_MS: u64 = 30_000;
'''
if lib.count(old_constants) != 1:
    raise SystemExit('lib.rs: first-pass refresh constants not found')
lib = lib.replace(old_constants, new_constants, 1)

runtime_start = lib.index('#[cfg(not(any(target_os = "android", target_os = "ios")))]\n#[derive(Default)]\nstruct SourceRuntime')
runtime_end = lib.index('\nstruct RefreshClock {', runtime_start)
new_runtime = r'''#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Clone)]
struct RefreshBatch {
    requested_at: String,
    started_ms: u64,
    pending: Vec<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Default)]
struct SourceRuntime {
    active_refresh: Mutex<Option<RefreshBatch>>,
    codex_creating_since: AtomicU64,
    deepseek_creating_since: AtomicU64,
    volcengine_creating_since: AtomicU64,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl SourceRuntime {
    fn creation_flag(&self, source: &str) -> Result<&AtomicU64, String> {
        match source {
            "codex" => Ok(&self.codex_creating_since),
            "deepseek" => Ok(&self.deepseek_creating_since),
            "volcengine" => Ok(&self.volcengine_creating_since),
            _ => Err("未知数据源".into()),
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct CreationClaim<'a> {
    flag: &'a AtomicU64,
    token: u64,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl Drop for CreationClaim<'_> {
    fn drop(&mut self) {
        let _ = self
            .flag
            .compare_exchange(self.token, 0, Ordering::AcqRel, Ordering::Acquire);
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn claim_creation(flag: &AtomicU64, now_ms: u64) -> Option<CreationClaim<'_>> {
    let token = now_ms.max(1);
    loop {
        let previous = flag.load(Ordering::Acquire);
        if previous != 0 && token.saturating_sub(previous) < CREATION_STALE_MS {
            return None;
        }
        if flag
            .compare_exchange(previous, token, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return Some(CreationClaim { flag, token });
        }
    }
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
fn source_display_name(source: &str) -> String {
    match source {
        "codex" => "Codex".into(),
        "deepseek" => "DeepSeek".into(),
        "volcengine" => "火山方舟".into(),
        _ => source.into(),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn begin_refresh_batch(runtime: &SourceRuntime, now_ms: u64) -> Result<Option<String>, String> {
    let mut active = runtime
        .active_refresh
        .lock()
        .map_err(|_| "后台刷新批次锁已损坏".to_string())?;
    if let Some(batch) = active.as_ref() {
        if now_ms.saturating_sub(batch.started_ms) < REFRESH_BATCH_TIMEOUT_MS {
            return Ok(None);
        }
    }

    let requested_at = now_ms.to_string();
    *active = Some(RefreshBatch {
        requested_at: requested_at.clone(),
        started_ms: now_ms,
        pending: ["codex", "deepseek", "volcengine"]
            .into_iter()
            .map(str::to_string)
            .collect(),
    });
    Ok(Some(requested_at))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn active_refresh_snapshot(
    runtime: &SourceRuntime,
) -> Result<Option<(String, Vec<String>)>, String> {
    runtime
        .active_refresh
        .lock()
        .map(|active| {
            active
                .as_ref()
                .map(|batch| (batch.requested_at.clone(), batch.pending.clone()))
        })
        .map_err(|_| "后台刷新批次锁已损坏".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn finish_refresh_source(
    runtime: &SourceRuntime,
    requested_at: &str,
    source: &str,
) -> Result<(), String> {
    let mut active = runtime
        .active_refresh
        .lock()
        .map_err(|_| "后台刷新批次锁已损坏".to_string())?;
    let Some(batch) = active.as_mut() else {
        return Ok(());
    };
    if batch.requested_at != requested_at {
        return Ok(());
    }
    batch.pending.retain(|value| value != source);
    if batch.pending.is_empty() {
        *active = None;
    }
    Ok(())
}
'''
lib = lib[:runtime_start] + new_runtime + lib[runtime_end:]

old_claim = '''    let flag = state.source_runtime.creation_flag(source)?;
    let Some(_claim) = claim_creation(flag) else {
'''
new_claim = '''    let flag = state.source_runtime.creation_flag(source)?;
    let Some(_claim) = claim_creation(flag, unix_millis()) else {
'''
if lib.count(old_claim) != 1:
    raise SystemExit('lib.rs: first-pass creation claim not found')
lib = lib.replace(old_claim, new_claim, 1)

old_refresh_start = '''    let state = app.state::<AppState>();
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
'''
new_refresh_start = '''    let state = app.state::<AppState>();
    let now_ms = unix_millis();
    let Some(sync_requested_at) = begin_refresh_batch(&state.source_runtime, now_ms)? else {
        let snapshot = active_refresh_snapshot(&state.source_runtime)?;
        let (requested_at, pending_ids) = snapshot
            .map(|(requested_at, pending)| (Some(requested_at), pending))
            .unwrap_or((None, Vec::new()));
        return Ok(RefreshSummary {
            requested_at,
            expected: pending_ids.clone(),
            refreshed: Vec::new(),
            started: Vec::new(),
            pending: pending_ids.iter().map(|source| source_display_name(source)).collect(),
            failed: Vec::new(),
            already_running: true,
        });
    };

    let refresh_minutes = state.refresh.get();
'''
if lib.count(old_refresh_start) != 1:
    raise SystemExit('lib.rs: first-pass refresh claim not found')
lib = lib.replace(old_refresh_start, new_refresh_start, 1)

old_existing_error = '''                    Err(error) => failed.push(format!("{source_name}：{error}")),
'''
new_existing_error = '''                    Err(error) => {
                        let _ = finish_refresh_source(
                            &state.source_runtime,
                            &sync_requested_at,
                            source,
                        );
                        failed.push(format!("{source_name}：{error}"));
                    }
'''
if lib.count(old_existing_error) < 1:
    raise SystemExit('lib.rs: existing-window refresh error arm not found')
lib = lib.replace(old_existing_error, new_existing_error, 1)

old_ensure_error = '''            Err(error) => failed.push(format!("{source_name}：{error}")),
'''
new_ensure_error = '''            Err(error) => {
                let _ = finish_refresh_source(
                    &state.source_runtime,
                    &sync_requested_at,
                    source,
                );
                failed.push(format!("{source_name}：{error}"));
            }
'''
if lib.count(old_ensure_error) != 1:
    raise SystemExit('lib.rs: ensure-window error arm not found')
lib = lib.replace(old_ensure_error, new_ensure_error, 1)

old_empty_release = '''    if expected.is_empty() {
        state
            .source_runtime
            .last_refresh_started_ms
            .store(0, Ordering::Release);
    }
'''
if lib.count(old_empty_release) != 1:
    raise SystemExit('lib.rs: first-pass empty refresh release not found')
lib = lib.replace(old_empty_release, '', 1)

store_anchor = '''    let payload = serde_json::from_slice::<Value>(&decoded)
        .map_err(|error| format!("采集数据 JSON 无效：{error}"))?;
    let state = app.state::<AppState>();
'''
store_new = '''    let payload = serde_json::from_slice::<Value>(&decoded)
        .map_err(|error| format!("采集数据 JSON 无效：{error}"))?;
    let sync_requested_at = payload
        .get("syncRequestedAt")
        .and_then(Value::as_str)
        .map(str::to_string);
    let state = app.state::<AppState>();
'''
if lib.count(store_anchor) != 1:
    raise SystemExit('lib.rs: metrics payload anchor not found')
lib = lib.replace(store_anchor, store_new, 1)

emit_anchor = '''    app.emit_to("main", "metrics-updated", snapshot)
        .map_err(|error| format!("无法通知主窗口：{error}"))?;
    Ok(())
}
'''
emit_new = '''    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(requested_at) = sync_requested_at.as_deref() {
        if let Err(error) = finish_refresh_source(
            &state.source_runtime,
            requested_at,
            source,
        ) {
            eprintln!("unable to record refresh receipt for {source}: {error}");
        }
    }
    app.emit_to("main", "metrics-updated", snapshot)
        .map_err(|error| format!("无法通知主窗口：{error}"))?;
    Ok(())
}
'''
if lib.count(emit_anchor) != 1:
    raise SystemExit('lib.rs: metrics emit anchor not found')
lib = lib.replace(emit_anchor, emit_new, 1)

unit_start = lib.index('#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]\nmod source_runtime_tests')
new_tests = r'''#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod source_runtime_tests {
    use super::*;

    #[test]
    fn refresh_batch_is_single_flight_until_receipts_or_timeout() {
        let runtime = SourceRuntime::default();
        let requested_at = begin_refresh_batch(&runtime, 100_000)
            .expect("batch lock should work")
            .expect("first batch should start");
        assert!(begin_refresh_batch(
            &runtime,
            100_000 + REFRESH_BATCH_TIMEOUT_MS - 1
        )
        .expect("batch lock should work")
        .is_none());

        finish_refresh_source(&runtime, &requested_at, "codex").unwrap();
        finish_refresh_source(&runtime, &requested_at, "deepseek").unwrap();
        assert!(active_refresh_snapshot(&runtime).unwrap().is_some());
        finish_refresh_source(&runtime, &requested_at, "volcengine").unwrap();
        assert!(active_refresh_snapshot(&runtime).unwrap().is_none());
        assert!(begin_refresh_batch(&runtime, 100_001).unwrap().is_some());
    }

    #[test]
    fn stale_source_creation_claim_can_recover_without_old_drop_clearing_it() {
        let flag = AtomicU64::new(0);
        let first = claim_creation(&flag, 100_000).expect("first creator should win");
        assert!(claim_creation(&flag, 100_000 + CREATION_STALE_MS - 1).is_none());
        let second = claim_creation(&flag, 100_000 + CREATION_STALE_MS)
            .expect("stale creation should be recoverable");
        drop(first);
        assert_ne!(flag.load(Ordering::Acquire), 0);
        drop(second);
        assert_eq!(flag.load(Ordering::Acquire), 0);
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
lib = lib[:unit_start] + new_tests + '\n'
write(lib_path, lib)

# Move tray-triggered window creation and refresh out of Tauri event handlers.
desktop_path = Path('src-tauri/src/desktop.rs')
desktop = read(desktop_path)
helper_anchor = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn build_tray(app: &tauri::App) -> tauri::Result<()> {
'''
helper_block = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_source_open(app: &AppHandle, source: &'static str) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = super::open_source_impl(&app, source) {
            eprintln!("tray source open failed for {source}: {error}");
        }
    });
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_source_refresh(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = reload_sources(&app) {
            eprintln!("tray source refresh failed: {error}");
        }
    });
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn build_tray(app: &tauri::App) -> tauri::Result<()> {
'''
if desktop.count(helper_anchor) != 1:
    raise SystemExit('desktop.rs: build_tray anchor not found')
desktop = desktop.replace(helper_anchor, helper_block, 1)
old_menu = '''            "codex" => {
                let _ = super::open_source_impl(app, "codex");
            }
            "deepseek" => {
                let _ = super::open_source_impl(app, "deepseek");
            }
            "volcengine" => {
                let _ = super::open_source_impl(app, "volcengine");
            }
            "refresh" => {
                let _ = reload_sources(app);
            }
'''
new_menu = '''            "codex" => spawn_source_open(app, "codex"),
            "deepseek" => spawn_source_open(app, "deepseek"),
            "volcengine" => spawn_source_open(app, "volcengine"),
            "refresh" => spawn_source_refresh(app),
'''
if desktop.count(old_menu) != 1:
    raise SystemExit('desktop.rs: synchronous tray source actions not found')
desktop = desktop.replace(old_menu, new_menu, 1)
write(desktop_path, desktop)

# Add a first-success-only, debounced readiness observer for late Volcengine SPA selection.
reader_path = Path('web/volcengine-chart-reader.js')
reader = read(reader_path)
state_old = '''    collecting: false,
    retryTimer: null,
    lastHref: location.href
'''
state_new = '''    collecting: false,
    retryTimer: null,
    readinessObserver: null,
    readinessTimer: null,
    lastPayloadAt: 0,
    lastHref: location.href
'''
if reader.count(state_old) != 1:
    raise SystemExit('volcengine reader: state anchor not found')
reader = reader.replace(state_old, state_new, 1)
retry_anchor = '''  async function collectAndSignal(options = {}) {
'''
observer_block = '''  function stopReadinessObserver() {
    if (state.readinessTimer) clearTimeout(state.readinessTimer);
    state.readinessTimer = null;
    state.readinessObserver?.disconnect();
    state.readinessObserver = null;
  }

  function installReadinessObserver() {
    if (state.lastPayloadAt || state.readinessObserver || typeof MutationObserver !== 'function') return;
    state.readinessObserver = new MutationObserver(() => {
      if (state.lastPayloadAt || state.readinessTimer) return;
      state.readinessTimer = setTimeout(() => {
        state.readinessTimer = null;
        installSyncOverride();
        collectAndSignal({ automatic: true, readiness: true }).catch(() => {});
      }, 700);
    });
    state.readinessObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  async function collectAndSignal(options = {}) {
'''
if reader.count(retry_anchor) != 1:
    raise SystemExit('volcengine reader: collect anchor not found')
reader = reader.replace(retry_anchor, observer_block, 1)
signal_old = '''      signal(payload);
      toolbarStatus(
'''
signal_new = '''      signal(payload);
      state.lastPayloadAt = Date.now();
      stopReadinessObserver();
      toolbarStatus(
'''
if reader.count(signal_old) != 1:
    raise SystemExit('volcengine reader: successful signal anchor not found')
reader = reader.replace(signal_old, signal_new, 1)
start_old = '''  function start() {
    installSyncOverride();
    for (const delay of [1200, 3200, 6500]) {
'''
start_new = '''  function start() {
    installSyncOverride();
    installReadinessObserver();
    for (const delay of [1200, 3200, 6500]) {
'''
if reader.count(start_old) != 1:
    raise SystemExit('volcengine reader: start anchor not found')
reader = reader.replace(start_old, start_new, 1)
write(reader_path, reader)

# Composer permits exactly the bounded Volcengine readiness observer, not the old canonical observer.
compose_path = Path('tools/compose-extractor.mjs')
compose = read(compose_path)
final_observer_old = "if (output.includes('new MutationObserver')) throw new Error('continuous DOM observer remains active');\n"
final_observer_new = "const observerCount = (output.match(/new MutationObserver/g) || []).length;\nif (observerCount !== 1 || !output.includes('readinessObserver')) throw new Error('bounded Volcengine readiness observer shape changed');\n"
if compose.count(final_observer_old) != 1:
    raise SystemExit('compose-extractor: final observer assertion not found')
compose = compose.replace(final_observer_old, final_observer_new, 1)
write(compose_path, compose)

# Update focused tests to assert true receipt-driven single-flight and safe tray behavior.
background_path = Path('tests/background-refresh-v097.test.mjs')
background = read(background_path)
background = background.replace(
    "const workflow = fs.readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');\n",
    "const workflow = fs.readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');\nconst desktop = fs.readFileSync(new URL('../src-tauri/src/desktop.rs', import.meta.url), 'utf8');\nconst compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');\n",
    1,
)
old_single = r'''test('manual, tray, and scheduled refresh share a native single-flight batch', () => {
  assert.match(rust, /REFRESH_MIN_GAP_MS: u64 = 12_000/);
  assert.match(refresh, /try_claim_refresh/);
  assert.match(refresh, /already_running: true/);
  assert.match(refresh, /expected\.push\(source\.to_string\(\)\)/);
  assert.match(refresh, /started\.push\(source_name\.to_string\(\)\)/);
  assert.match(refresh, /pending\.push\(source_name\.to_string\(\)\)/);
  assert.match(refresh, /schedule_follow_up_refresh/);
  assert.doesNotMatch(refresh, /后台窗口不存在/);
});
'''
new_single = r'''test('manual, tray, and scheduled refresh share a receipt-driven native batch', () => {
  assert.match(rust, /REFRESH_BATCH_TIMEOUT_MS: u64 = 30_000/);
  assert.match(rust, /active_refresh: Mutex<Option<RefreshBatch>>/);
  assert.match(refresh, /begin_refresh_batch/);
  assert.match(refresh, /already_running: true/);
  assert.match(refresh, /expected\.push\(source\.to_string\(\)\)/);
  assert.match(refresh, /started\.push\(source_name\.to_string\(\)\)/);
  assert.match(refresh, /pending\.push\(source_name\.to_string\(\)\)/);
  assert.match(refresh, /schedule_follow_up_refresh/);
  assert.match(rust, /finish_refresh_source/);
  assert.match(rust, /payload\s*\.get\("syncRequestedAt"\)/);
  assert.doesNotMatch(refresh, /后台窗口不存在/);
});

test('tray event handlers never create or refresh WebViews synchronously', () => {
  assert.match(desktop, /fn spawn_source_open/);
  assert.match(desktop, /fn spawn_source_refresh/);
  assert.match(desktop, /std::thread::spawn\(move \|\|/);
  assert.match(desktop, /"codex" => spawn_source_open/);
  assert.match(desktop, /"refresh" => spawn_source_refresh/);
});
'''
if old_single not in background:
    raise SystemExit('background test: first-pass single-flight test not found')
background = background.replace(old_single, new_single, 1)
old_reader = r'''test('all generated source readers autonomously collect after hidden-window startup', () => {
  assert.match(deepseek, /1800/);
  assert.match(deepseek, /5200/);
  assert.match(volcengine, /\[1200, 3200, 6500\]/);
  assert.match(rust, /setTimeout\(run, 250\)/);
});
'''
new_reader = r'''test('all generated source readers autonomously collect after hidden-window startup', () => {
  assert.match(deepseek, /1800/);
  assert.match(deepseek, /5200/);
  assert.match(volcengine, /\[1200, 3200, 6500\]/);
  assert.match(volcengine, /installReadinessObserver/);
  assert.match(volcengine, /readinessObserver\?\.disconnect\(\)/);
  assert.match(volcengine, /state\.lastPayloadAt = Date\.now\(\)/);
  assert.match(compose, /observerCount !== 1/);
  assert.match(rust, /setTimeout\(run, 250\)/);
});
'''
if old_reader not in background:
    raise SystemExit('background test: reader startup test not found')
background = background.replace(old_reader, new_reader, 1)
write(background_path, background)

# Existing long-running contract should allow only the bounded readiness observer.
long_path = Path('tests/long-running-sync-v095.test.mjs')
long_text = read(long_path)
old_unused = '''  for (const source of [base, built]) {
    assert.doesNotMatch(source, /installVolcengineNetworkCapture/);
    assert.doesNotMatch(source, /__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__/);
  }
'''
new_unused = '''  for (const source of [base, built]) {
    assert.doesNotMatch(source, /installVolcengineNetworkCapture/);
    assert.doesNotMatch(source, /__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__/);
  }
  assert.equal((built.match(/new MutationObserver/g) || []).length, 1);
  assert.match(built, /readinessObserver/);
'''
if long_text.count(old_unused) != 1:
    raise SystemExit('long-running test: cache assertion anchor not found')
long_text = long_text.replace(old_unused, new_unused, 1)
write(long_path, long_text)

# Documentation now describes actual receipt-driven single-flight semantics.
readme_path = Path('README.md')
readme = read(readme_path)
readme = readme.replace(
    '- 原生层对按钮、托盘和定时器实行 12 秒刷新单飞；Codex/DeepSeek 重新载入，火山方舟只调用当前企业版 SPA 页面内同步并保留视图。',
    '- 原生层对按钮、托盘和定时器实行回执驱动的刷新单飞：三个来源全部返回即释放，30 秒后自动过期；Codex/DeepSeek 重新载入，火山方舟只调用当前企业版 SPA 页面内同步并保留视图。',
    1,
)
readme = readme.replace(
    '- 火山方舟首次登录仍需进入 Agent Plan 企业版“用量统计”；识别到 AFP 页面后会自动同步，以后隐藏窗口保持该页面状态。',
    '- 火山方舟首次登录仍需进入 Agent Plan 企业版“用量统计”；首次成功前使用防抖页面就绪观察器，识别到 AFP 页面即自动同步并立即停止观察，以后隐藏窗口保持该页面状态。',
    1,
)
write(readme_path, readme)

doc_path = Path('docs/v0.9.7.md')
doc = read(doc_path)
doc = doc.replace(
    '- 原生层以 12 秒间隔合并按钮、托盘和定时器刷新，避免页面连续 reload。',
    '- 原生层用回执驱动批次合并按钮、托盘和定时器刷新；三个来源全部返回即释放，30 秒无回执则自动过期，避免页面连续 reload。',
    1,
)
doc = doc.replace(
    '- 新建窗口在匹配来源域名的首次页面加载完成后注入一次同步请求；已有 Codex/DeepSeek 窗口 reload，火山窗口只调用页面内同步以保留 SPA 状态。',
    '- 新建窗口在匹配来源域名的首次页面加载完成后注入一次同步请求；已有 Codex/DeepSeek 窗口 reload，火山窗口只调用页面内同步以保留 SPA 状态。托盘窗口创建和刷新也移到独立线程，避开 Windows 事件处理器死锁风险。',
    1,
)
doc = doc.replace(
    '- 控制中心用 `syncRequestedAt` 批次 ID 核对实际返回：15 秒仅限制原生命令等待，20 秒收集窗口后列出未返回来源，后台任务不会因此取消。',
    '- 控制中心用 `syncRequestedAt` 批次 ID 核对实际返回：15 秒仅限制原生命令等待，20 秒收集窗口后列出未返回来源，后台任务不会因此取消。火山首次成功前以防抖 DOM 就绪观察器识别较晚发生的 SPA 页面切换，成功后立即断开。',
    1,
)
write(doc_path, doc)
