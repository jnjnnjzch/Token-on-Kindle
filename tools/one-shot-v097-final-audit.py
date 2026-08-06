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
lib = read(lib_path)
lib = lib.replace(
    'atomic::{AtomicBool, AtomicU64, Ordering}',
    'atomic::{AtomicU64, Ordering}',
    1,
)

old_create = '''    create_source_window(app, source, initial_sync)
        .map_err(|error| format!("无法创建 {label} 数据源窗口：{error}"))?;
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} 数据源窗口创建后不可用"))?;
'''
new_create = '''    if let Err(error) = create_source_window(app, source, initial_sync) {
        if let Some(window) = app.get_webview_window(label) {
            return Ok(SourceWindowState::Existing(window));
        }
        return Err(format!("无法创建 {label} 数据源窗口：{error}"));
    }
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} 数据源窗口创建后不可用"))?;
'''
if lib.count(old_create) != 1:
    raise SystemExit('lib.rs: ensure_source_window create block changed')
lib = lib.replace(old_create, new_create, 1)
lib = lib.replace('    for _ in 0..60 {\n', '    for _ in 0..150 {\n', 1)

follow_start = lib.index('#[cfg(not(any(target_os = "android", target_os = "ios")))]\nfn schedule_follow_up_refresh(')
follow_end = lib.index('\n#[cfg(not(any(target_os = "android", target_os = "ios")))]\nfn start_source_warmup', follow_start)
worker_block = r'''#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn report_source_refresh_failure(
    app: &AppHandle,
    requested_at: &str,
    source: &str,
    source_name: &str,
    error: String,
) {
    let state = app.state::<AppState>();
    if let Err(batch_error) = finish_refresh_source(
        &state.source_runtime,
        requested_at,
        source,
    ) {
        eprintln!("unable to close failed refresh source {source}: {batch_error}");
    }
    if let Err(emit_error) = app.emit_to(
        "main",
        "source-refresh-failed",
        serde_json::json!({
            "requestedAt": requested_at,
            "source": source,
            "name": source_name,
            "error": error,
        }),
    ) {
        eprintln!("unable to report failed refresh source {source}: {emit_error}");
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn refresh_source_worker(
    app: AppHandle,
    source: &'static str,
    source_name: &'static str,
    reload_page: bool,
    refresh_minutes: u64,
    sync_requested_at: String,
) {
    let initial_sync = InitialSync {
        refresh_minutes,
        requested_at: Some(sync_requested_at.clone()),
    };
    let result = match ensure_source_window(&app, source, initial_sync) {
        Ok(SourceWindowState::Existing(window)) => background_refresh_window(
            &window,
            reload_page,
            refresh_minutes,
            &sync_requested_at,
        ),
        Ok(SourceWindowState::Created(window)) => {
            let _ = window.hide();
            Ok(())
        }
        Ok(SourceWindowState::Starting) => wait_for_source_window(&app, source).and_then(|window| {
            let _ = window.hide();
            background_refresh_window(
                &window,
                false,
                refresh_minutes,
                &sync_requested_at,
            )
        }),
        Err(error) => Err(error),
    };

    if let Err(error) = result {
        report_source_refresh_failure(
            &app,
            &sync_requested_at,
            source,
            source_name,
            error,
        );
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_source_refresh_worker(
    app: &AppHandle,
    source: &'static str,
    source_name: &'static str,
    reload_page: bool,
    refresh_minutes: u64,
    sync_requested_at: &str,
) -> Result<(), String> {
    let app = app.clone();
    let requested_at = sync_requested_at.to_string();
    thread::Builder::new()
        .name(format!("token-refresh-{source}"))
        .spawn(move || {
            refresh_source_worker(
                app,
                source,
                source_name,
                reload_page,
                refresh_minutes,
                requested_at,
            );
        })
        .map(|_| ())
        .map_err(|error| format!("{source_name} 后台线程启动失败：{error}"))
}
'''
lib = lib[:follow_start] + worker_block + lib[follow_end:]

reload_start = lib.index('#[cfg(not(any(target_os = "android", target_os = "ios")))]\nfn reload_sources(app: &AppHandle)')
reload_end = lib.index('\n#[cfg(any(target_os = "android", target_os = "ios"))]\nfn reload_sources', reload_start)
new_reload = r'''#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reload_sources(app: &AppHandle) -> Result<RefreshSummary, String> {
    let state = app.state::<AppState>();
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
    let mut expected = Vec::new();
    let mut pending = Vec::new();
    let mut failed = Vec::new();

    for (source, source_name, reload_page) in [
        ("codex", "Codex", true),
        ("deepseek", "DeepSeek", true),
        ("volcengine", "火山方舟", false),
    ] {
        match spawn_source_refresh_worker(
            app,
            source,
            source_name,
            reload_page,
            refresh_minutes,
            &sync_requested_at,
        ) {
            Ok(()) => {
                expected.push(source.to_string());
                pending.push(source_name.to_string());
            }
            Err(error) => {
                let _ = finish_refresh_source(
                    &state.source_runtime,
                    &sync_requested_at,
                    source,
                );
                failed.push(error);
            }
        }
    }

    Ok(RefreshSummary {
        requested_at: Some(sync_requested_at),
        expected,
        refreshed: Vec::new(),
        started: Vec::new(),
        pending,
        failed,
        already_running: false,
    })
}
'''
lib = lib[:reload_start] + new_reload + lib[reload_end:]
write(lib_path, lib)

app_path = Path('web/app.js')
app = read(app_path)
app = app.replace('  if (result?.alreadyRunning) return null;\n', '', 1)
app = app.replace(
    "  activeRefresh = { requestedAt, expected, pending: [...expected] };\n",
    "  activeRefresh = { requestedAt, expected, pending: [...expected], failures: [] };\n",
    1,
)
old_reconcile = '''  const returned = activeRefresh.expected.filter(source => !activeRefresh.pending.includes(source));
  if (!activeRefresh.pending.length) {
    clearRefreshReceipt();
    return serviceDescription('本轮后台同步完成');
  }
  return serviceDescription(returned.length
    ? `已返回 ${returned.map(sourceName).join('、')}；等待 ${activeRefresh.pending.map(sourceName).join('、')}`
    : `等待 ${activeRefresh.pending.map(sourceName).join('、')} 返回`);
'''
new_reconcile = '''  const returned = activeRefresh.expected.filter(source => !activeRefresh.pending.includes(source));
  const failures = [...activeRefresh.failures];
  if (!activeRefresh.pending.length) {
    clearRefreshReceipt();
    return serviceDescription(failures.length
      ? `本轮后台同步完成；失败：${failures.join('；')}`
      : '本轮后台同步完成');
  }
  const progress = returned.length
    ? `已返回 ${returned.map(sourceName).join('、')}；等待 ${activeRefresh.pending.map(sourceName).join('、')}`
    : `等待 ${activeRefresh.pending.map(sourceName).join('、')} 返回`;
  return serviceDescription(failures.length ? `${progress}；失败：${failures.join('；')}` : progress);
'''
if app.count(old_reconcile) != 1:
    raise SystemExit('app.js: reconcileRefreshReceipt block changed')
app = app.replace(old_reconcile, new_reconcile, 1)
listener_anchor = '''  await listen('metrics-updated', event => {
    state = { ...event.payload, refreshMinutes: state.refreshMinutes };
    const refreshStatus = reconcileRefreshReceipt();
    document.querySelector('#service').textContent = refreshStatus || serviceDescription('已收到最新数据');
    updateUi();
  });
'''
failure_listener = listener_anchor + '''  await listen('source-refresh-failed', event => {
    const payload = event.payload || {};
    const requestedAt = String(payload.requestedAt || '');
    const source = String(payload.source || '');
    const detail = `${payload.name || sourceName(source)}：${payload.error || '未知错误'}`;
    if (activeRefresh && activeRefresh.requestedAt === requestedAt) {
      activeRefresh.pending = activeRefresh.pending.filter(value => value !== source);
      if (!activeRefresh.failures.includes(detail)) activeRefresh.failures.push(detail);
      const refreshStatus = reconcileRefreshReceipt();
      if (refreshStatus) document.querySelector('#service').textContent = refreshStatus;
      return;
    }
    document.querySelector('#service').textContent = serviceDescription(`后台刷新失败：${detail}`);
  });
'''
if app.count(listener_anchor) != 1:
    raise SystemExit('app.js: metrics listener changed')
app = app.replace(listener_anchor, failure_listener, 1)
write(app_path, app)

reader_path = Path('web/volcengine-chart-reader.js')
reader = read(reader_path)
reader = reader.replace(
    '  const MAX_CACHED_CHART_AGE_MS = 90_000;\n',
    '  const MAX_CACHED_CHART_AGE_MS = 90_000;\n  const READINESS_OBSERVER_MAX_MS = 15 * 60 * 1000;\n  const READINESS_ATTEMPT_MIN_MS = 3000;\n',
    1,
)
reader = reader.replace(
    '''    readinessObserver: null,
    readinessTimer: null,
    lastPayloadAt: 0,
''',
    '''    readinessObserver: null,
    readinessTimer: null,
    readinessDeadlineTimer: null,
    lastReadinessAttemptAt: 0,
    lastPayloadAt: 0,
''',
    1,
)
old_observer_start = reader.index('  function stopReadinessObserver() {')
old_observer_end = reader.index('\n  async function collectAndSignal(options = {}) {', old_observer_start)
observer_block = r'''  function stopReadinessObserver() {
    if (state.readinessTimer) clearTimeout(state.readinessTimer);
    if (state.readinessDeadlineTimer) clearTimeout(state.readinessDeadlineTimer);
    state.readinessTimer = null;
    state.readinessDeadlineTimer = null;
    state.readinessObserver?.disconnect();
    state.readinessObserver = null;
  }

  function readinessHint() {
    return WINDOWS.some(definition => exactVisibleElement(definition.label)) || Boolean(exactVisibleElement('模型调用明细'));
  }

  function installReadinessObserver() {
    if (state.lastPayloadAt || state.readinessObserver || typeof MutationObserver !== 'function') return;
    state.readinessObserver = new MutationObserver(() => {
      if (state.lastPayloadAt || state.readinessTimer) return;
      const elapsed = Date.now() - state.lastReadinessAttemptAt;
      const delay = Math.max(700, READINESS_ATTEMPT_MIN_MS - elapsed);
      state.readinessTimer = setTimeout(() => {
        state.readinessTimer = null;
        if (!readinessHint()) return;
        state.lastReadinessAttemptAt = Date.now();
        installSyncOverride();
        collectAndSignal({ automatic: true, readiness: true }).catch(() => {});
      }, delay);
    });
    state.readinessObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    state.readinessDeadlineTimer = setTimeout(stopReadinessObserver, READINESS_OBSERVER_MAX_MS);
  }
'''
reader = reader[:old_observer_start] + observer_block + reader[old_observer_end:]
for event_marker in [
    "  window.addEventListener('pageshow', () => {\n    resetDomCache(true);\n    installSyncOverride();\n",
    "  window.addEventListener('popstate', () => {\n    if (location.href === state.lastHref) return;\n    state.lastHref = location.href;\n    resetDomCache(true);\n",
    "  window.addEventListener('hashchange', () => {\n    state.lastHref = location.href;\n    resetDomCache(true);\n",
]:
    if event_marker not in reader:
        raise SystemExit(f'volcengine reader event marker changed: {event_marker[:40]}')
    reader = reader.replace(event_marker, event_marker + '    installReadinessObserver();\n', 1)
write(reader_path, reader)

# Update all six stale assertions identified from the complete 122-test failure log.
background_path = Path('tests/background-refresh-v097.test.mjs')
background = read(background_path)
background = background.replace('assert.match(rust, /codex_creating: AtomicBool/);', 'assert.match(rust, /codex_creating_since: AtomicU64/);', 1)
background = background.replace('assert.match(rust, /deepseek_creating: AtomicBool/);', 'assert.match(rust, /deepseek_creating_since: AtomicU64/);', 1)
background = background.replace('assert.match(rust, /volcengine_creating: AtomicBool/);', 'assert.match(rust, /volcengine_creating_since: AtomicU64/);', 1)
background = background.replace('assert.match(rust, /claim_creation\\(flag\\)/);', 'assert.match(rust, /claim_creation\\(flag, unix_millis\\(\\)\\)/);', 1)
background = background.replace(
    "  assert.match(refresh, /schedule_follow_up_refresh/);\n",
    "  assert.match(refresh, /spawn_source_refresh_worker/);\n  assert.match(rust, /fn refresh_source_worker/);\n",
    1,
)
background = background.replace(
    "  assert.match(rust, /finish_refresh_source/);\n",
    "  assert.match(rust, /finish_refresh_source/);\n  assert.match(rust, /source-refresh-failed/);\n",
    1,
)
background = background.replace(
    "  assert.match(volcengine, /state\\.lastPayloadAt = Date\\.now\\(\\)/);\n",
    "  assert.match(volcengine, /state\\.lastPayloadAt = Date\\.now\\(\\)/);\n  assert.match(volcengine, /READINESS_OBSERVER_MAX_MS = 15 \\* 60 \\* 1000/);\n  assert.match(volcengine, /READINESS_ATTEMPT_MIN_MS = 3000/);\n  assert.match(volcengine, /readinessHint/);\n",
    1,
)
write(background_path, background)

cross_path = Path('tests/cross-platform-compose-v085.test.mjs')
cross = read(cross_path)
cross = cross.replace(
    '  assert.doesNotMatch(built, /new MutationObserver/);\n',
    "  assert.equal((built.match(/new MutationObserver/g) || []).length, 1);\n  assert.match(built, /readinessObserver/);\n  assert.match(built, /READINESS_OBSERVER_MAX_MS/);\n",
    1,
)
write(cross_path, cross)

dynamic_path = Path('tests/dynamic-layout-sync-v082.test.mjs')
dynamic = read(dynamic_path)
dynamic = dynamic.replace(
    '  assert.match(refreshBlock, /match background_refresh_window\\(/);\n  assert.match(refreshBlock, /Err\\(error\\) => failed\\.push/);\n',
    '  assert.match(refreshBlock, /spawn_source_refresh_worker/);\n  assert.match(native, /report_source_refresh_failure/);\n',
    1,
)
write(dynamic_path, dynamic)

chart_path = Path('tests/volcengine-direct-chart-v084.test.mjs')
chart = read(chart_path)
chart = chart.replace(
    '  assert.doesNotMatch(reader, /MutationObserver/);\n',
    '  assert.equal((reader.match(/new MutationObserver/g) || []).length, 1);\n  assert.match(reader, /readinessObserver/);\n  assert.match(reader, /READINESS_OBSERVER_MAX_MS/);\n',
    1,
)
chart = chart.replace(
    '  assert.doesNotMatch(built, /new MutationObserver/);\n',
    '  assert.equal((built.match(/new MutationObserver/g) || []).length, 1);\n  assert.match(built, /readinessObserver/);\n',
    1,
)
write(chart_path, chart)

sticky_path = Path('tests/volcengine-sticky-refresh-v094.test.mjs')
sticky = read(sticky_path)
sticky = sticky.replace(
    '  assert.match(refreshBlock, /match background_refresh_window\\(/);\n  assert.match(refreshBlock, /Ok\\(RefreshSummary \\{ refreshed, failed \\}\\)/);\n',
    '  assert.match(refreshBlock, /spawn_source_refresh_worker/);\n  assert.match(refreshBlock, /requested_at: Some\\(sync_requested_at\\)/);\n  assert.match(refreshBlock, /already_running: false/);\n',
    1,
)
write(sticky_path, sticky)

windows_path = Path('tests/windows-background-focus-v081.test.mjs')
windows = read(windows_path)
windows = windows.replace(
    '  assert.match(refreshBlock, /Err\\(error\\) => failed\\.push/);\n',
    '  assert.match(refreshBlock, /spawn_source_refresh_worker/);\n  assert.match(native, /report_source_refresh_failure/);\n',
    1,
)
write(windows_path, windows)

startup_path = Path('tests/main-window-startup-v096.test.mjs')
startup = read(startup_path)
startup = startup.replace(
    '  assert.match(refresh, /schedule_follow_up_refresh/);\n',
    '  assert.match(refresh, /spawn_source_refresh_worker/);\n',
    1,
)
write(startup_path, startup)

readme_path = Path('README.md')
readme = read(readme_path)
readme = readme.replace(
    '- 启动预热、卡片点击、定时刷新和“立即刷新”共享每来源创建锁；缺失窗口会自动补建，正在创建的窗口会安排后续刷新，不再要求先手动点击卡片。',
    '- 启动预热、卡片点击、定时刷新和“立即刷新”共享每来源创建锁；刷新为三个来源分别启动独立 worker，缺失窗口自动补建，单个 WebView 卡住不会阻塞其他来源。',
    1,
)
readme = readme.replace(
    '- 火山方舟首次登录仍需进入 Agent Plan 企业版“用量统计”；首次成功前使用防抖页面就绪观察器，识别到 AFP 页面即自动同步并立即停止观察，以后隐藏窗口保持该页面状态。',
    '- 火山方舟首次登录仍需进入 Agent Plan 企业版“用量统计”；首次成功前使用最多 15 分钟、最短 3 秒触发间隔的防抖页面就绪观察器，识别到 AFP 页面即自动同步并立即停止观察，以后隐藏窗口保持该页面状态。',
    1,
)
write(readme_path, readme)

doc_path = Path('docs/v0.9.7.md')
doc = read(doc_path)
doc = doc.replace(
    '- 缺失窗口由刷新自动补建；窗口正在创建时安排后续刷新，不把“正在启动”当成同步成功。',
    '- 刷新为三个来源分别启动独立 worker；缺失窗口自动补建，正在创建的窗口等待后注入批次同步，单个 WebView 卡住不会阻塞其他来源。',
    1,
)
doc = doc.replace(
    '火山首次成功前以防抖 DOM 就绪观察器识别较晚发生的 SPA 页面切换，成功后立即断开。',
    '火山首次成功前以最多 15 分钟、最短 3 秒触发间隔的防抖 DOM 就绪观察器识别较晚发生的 SPA 页面切换，成功后立即断开。',
    1,
)
write(doc_path, doc)
