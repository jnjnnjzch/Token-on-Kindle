from pathlib import Path
import re


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

create_anchor = '''    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
'''
ensure_block = '''    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn ensure_source_window(
    app: &AppHandle,
    source: &str,
) -> Result<(WebviewWindow, bool), String> {
    let (label, _, _) = source_url(source)?;
    if let Some(window) = app.get_webview_window(label) {
        return Ok((window, false));
    }

    create_source_window(app, source)
        .map_err(|error| format!("无法创建 {label} 数据源窗口：{error}"))?;
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} 数据源窗口创建后不可用"))?;
    Ok((window, true))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
'''
if lib.count(create_anchor) != 1:
    raise SystemExit('lib.rs: create/open anchor changed')
lib = lib.replace(create_anchor, ensure_block, 1)

old_open = '''fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
    let (label, _, _) = source_url(source)?;
    let window = if let Some(window) = app.get_webview_window(label) {
        window
    } else {
        create_source_window(app, source)
            .map_err(|error| format!("无法创建 {label} 数据源窗口：{error}"))?;
        app.get_webview_window(label)
            .ok_or_else(|| format!("{label} 数据源窗口创建后不可用"))?
    };
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}
'''
new_open = '''fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
    let (window, _) = ensure_source_window(app, source)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}
'''
if lib.count(old_open) != 1:
    raise SystemExit('lib.rs: open_source_impl anchor changed')
lib = lib.replace(old_open, new_open, 1)

start = lib.index('fn background_refresh_window(')
end = lib.index('\n#[cfg(not(any(target_os = "android", target_os = "ios")))]\nfn reload_sources', start)
new_background = '''fn background_refresh_window(
    window: &WebviewWindow,
    reload_page: bool,
    refresh_minutes: u64,
    sync_requested_at: &str,
) -> Result<(), String> {
    let sync_script = format!(
        r#"(() => {{
          const options = {{ automatic: true, refreshMinutes: {refresh_minutes}, syncRequestedAt: \"{sync_requested_at}\" }};
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
    );
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
'''
lib = lib[:start] + new_background + lib[end:]

start = lib.index('fn reload_sources(app: &AppHandle) -> Result<RefreshSummary, String> {', lib.index(new_background))
end = lib.index('\n#[cfg(any(target_os = "android", target_os = "ios"))]\nfn reload_sources', start)
new_reload = '''fn reload_sources(app: &AppHandle) -> Result<RefreshSummary, String> {
    let refresh_minutes = app.state::<AppState>().refresh.get();
    let sync_requested_at = timestamp();
    let mut refreshed = Vec::new();
    let mut failed = Vec::new();

    for (source, source_name, reload_page) in [
        ("codex", "Codex", true),
        ("deepseek", "DeepSeek", true),
        ("volcengine", "火山方舟", false),
    ] {
        let (window, created) = match ensure_source_window(app, source) {
            Ok(result) => result,
            Err(error) => {
                failed.push(format!("{source_name}：{error}"));
                continue;
            }
        };

        if created {
            let _ = window.hide();
            refreshed.push(format!("{source_name}（已启动）"));
            continue;
        }

        match background_refresh_window(&window, reload_page, refresh_minutes, &sync_requested_at) {
            Ok(()) => refreshed.push(source_name.to_string()),
            Err(error) => failed.push(format!("{source_name}：{error}")),
        }
    }

    if refreshed.is_empty() {
        return Err(if failed.is_empty() {
            "没有可刷新的后台窗口".into()
        } else {
            format!("所有数据源刷新失败：{}", failed.join("；"))
        });
    }

    if !failed.is_empty() {
        eprintln!("partial source refresh failure: {}", failed.join(" | "));
    }
    Ok(RefreshSummary { refreshed, failed })
}
'''
lib = lib[:start] + new_reload + lib[end:]

setup_anchor = '''                .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
                .build()?;

            start_refresh_scheduler(app.handle().clone(), Arc::clone(&refresh));
'''
setup_new = '''                .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
                .build()?;

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            for source in ["codex", "deepseek", "volcengine"] {
                if let Err(error) = create_source_window(app.handle(), source) {
                    eprintln!("source window warm-up failed for {source}: {error}");
                }
            }

            start_refresh_scheduler(app.handle().clone(), Arc::clone(&refresh));
'''
if lib.count(setup_anchor) != 1:
    raise SystemExit('lib.rs: setup anchor changed')
lib = lib.replace(setup_anchor, setup_new, 1)
lib_path.write_text(lib, encoding='utf-8')

app_path = Path('web/app.js')
app = app_path.read_text(encoding='utf-8')
app = app.replace('const PUBLISH_DEBOUNCE_MS = 350;\n', 'const PUBLISH_DEBOUNCE_MS = 350;\nconst REFRESH_COMMAND_TIMEOUT_MS = 15_000;\n', 1)
open_old = '''    document.querySelector('#service').textContent = source === 'volcengine'
      ? '请进入 Agent Plan 企业版的“用量统计”，看到 AFP 卡片后点击“同步至 Kindle”'
      : `${name} 页面已打开，请登录后点击“同步至 Kindle”`;
'''
open_new = '''    document.querySelector('#service').textContent = source === 'volcengine'
      ? '请进入 Agent Plan 企业版的“用量统计”；识别到 AFP 卡片后会自动同步，也可手动同步'
      : `${name} 页面已打开；登录后会自动同步，也可手动同步`;
'''
if app.count(open_old) != 1:
    raise SystemExit('app.js: openSource copy anchor changed')
app = app.replace(open_old, open_new, 1)
refresh_anchor = '''async function refreshNow() {
'''
refresh_helper = '''async function invokeRefreshSources() {
  let timer = null;
  try {
    return await Promise.race([
      invoke('refresh_sources'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('刷新命令超过 15 秒未返回')), REFRESH_COMMAND_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function refreshNow() {
'''
if app.count(refresh_anchor) != 1:
    raise SystemExit('app.js: refreshNow anchor changed')
app = app.replace(refresh_anchor, refresh_helper, 1)
app = app.replace("    const result = await invoke?.('refresh_sources');\n", "    const result = await invokeRefreshSources();\n", 1)
app_path.write_text(app, encoding='utf-8')

# Replace the v0.9.6 startup contract with the corrected non-fatal warm-up contract.
test_path = Path('tests/main-window-startup-v096.test.mjs')
test = test_path.read_text(encoding='utf-8')
start = test.index("test('main window startup")
end = test.index("test('dashboard PNG", start)
replacement = '''test('main window starts first and provider warm-up is non-fatal', () => {
  assert.match(rust, /fn ensure_source_window\\(/);
  assert.match(setup, /for source in \\["codex", "deepseek", "volcengine"\\]/);
  assert.match(setup, /if let Err\\(error\\) = create_source_window\\(app\\.handle\\(\\), source\\)/);
  assert.doesNotMatch(setup, /create_source_window\\([^)]*\\)\\?/);
  assert.doesNotMatch(setup, /initialization_script\\(EXTRACTOR_SCRIPT\\)/);
  assert.equal((rust.match(/\\.initialization_script\\(EXTRACTOR_SCRIPT\\)/g) || []).length, 1);
});

test('manual and scheduled refresh recreate missing provider windows', () => {
  const refresh = rust.slice(rust.indexOf('fn reload_sources(app: &AppHandle)'), rust.indexOf('#[cfg(any(target_os = "android"', rust.indexOf('fn reload_sources(app: &AppHandle)')));
  assert.match(refresh, /ensure_source_window\\(app, source\\)/);
  assert.match(refresh, /\\("codex", "Codex", true\\)/);
  assert.match(refresh, /\\("deepseek", "DeepSeek", true\\)/);
  assert.match(refresh, /\\("volcengine", "火山方舟", false\\)/);
  assert.match(refresh, /if created/);
  assert.match(refresh, /已启动/);
});

'''
test = test[:start] + replacement + test[end:]
test_path.write_text(test, encoding='utf-8')

# Update the old v0.8.7 assertion that explicitly prohibited a bounded native command.
stability = Path('tests/refresh-stability-v087.test.mjs')
text = stability.read_text(encoding='utf-8')
old = '''test('manual refresh returns to the stable single-flight flow', () => {
  assert.match(app, /refreshInFlight/);
  assert.match(app, /await invoke\\?\\.\\('refresh_sources'\\)/);
  assert.doesNotMatch(app, /REFRESH_COMMAND_TIMEOUT_MS|REFRESH_COOLDOWN_MS|invokeWithTimeout/);
  assert.match(app, /正在重新载入数据源/);
});
'''
new = '''test('manual refresh is single-flight and always releases the UI', () => {
  assert.match(app, /refreshInFlight/);
  assert.match(app, /REFRESH_COMMAND_TIMEOUT_MS = 15_000/);
  assert.match(app, /Promise\\.race/);
  assert.match(app, /invokeRefreshSources\\(\\)/);
  assert.match(app, /clearTimeout\\(timer\\)/);
  assert.match(app, /正在重新载入数据源/);
});
'''
if text.count(old) != 1:
    raise SystemExit('refresh-stability-v087 test anchor changed')
stability.write_text(text.replace(old, new, 1), encoding='utf-8')

new_test = Path('tests/background-refresh-v097.test.mjs')
new_test.write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

test('cold-start refresh auto-creates all missing source windows', () => {
  const refreshStart = rust.indexOf('fn reload_sources(app: &AppHandle)');
  const refreshEnd = rust.indexOf('#[cfg(any(target_os = "android"', refreshStart);
  const refresh = rust.slice(refreshStart, refreshEnd);
  assert.match(refresh, /ensure_source_window\\(app, source\\)/);
  assert.match(refresh, /if created/);
  assert.match(refresh, /refreshed\\.push\\(format!\\("\\{source_name\\}（已启动）"\\)\\)/);
  assert.doesNotMatch(refresh, /后台窗口不存在/);
});

test('startup warm-up failures cannot terminate the dashboard', () => {
  const setupStart = rust.indexOf('.setup(move |app|');
  const setupEnd = rust.indexOf('.on_window_event', setupStart);
  const setup = rust.slice(setupStart, setupEnd);
  assert.match(setup, /if let Err\\(error\\) = create_source_window/);
  assert.doesNotMatch(setup, /create_source_window\\([^)]*\\)\\?/);
});

test('refresh command has a hard UI timeout and auto-sync copy', () => {
  assert.match(app, /REFRESH_COMMAND_TIMEOUT_MS = 15_000/);
  assert.match(app, /刷新命令超过 15 秒未返回/);
  assert.match(app, /登录后会自动同步/);
  assert.match(app, /识别到 AFP 卡片后会自动同步/);
});
''', encoding='utf-8')

readme = Path('README.md')
text = readme.read_text(encoding='utf-8')
text = text.replace('当前稳定版：**v0.9.6**', '当前稳定版：**v0.9.7**', 1)
text = text.replace('/releases/tag/v0.9.6)', '/releases/tag/v0.9.7)', 1)
anchor = '## v0.9.6 主界面启动稳定性修复\n'
section = '''## v0.9.7 后台刷新回归修复

- 恢复 v0.6.2 的隐藏数据源预热思路，但任何单个 WebView 创建失败都不会终止主界面。
- 定时刷新和“立即刷新”会自动创建缺失的 Codex、DeepSeek、火山方舟窗口，不再要求先手动点击卡片。
- 新建窗口会依靠采集脚本自动同步；已有窗口继续执行来源专用刷新逻辑。
- “立即刷新”增加 15 秒界面保护，原生命令异常时按钮也不会永久转圈。

'''
if anchor not in text:
    raise SystemExit('README v0.9.6 anchor changed')
readme.write_text(text.replace(anchor, section + anchor, 1), encoding='utf-8')
