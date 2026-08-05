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


# Keep the main dashboard independent from all external provider WebViews.
lib = Path('src-tauri/src/lib.rs')
text = lib.read_text(encoding='utf-8')
text = text.replace(
    'fn create_source_window(app: &tauri::App, source: &str) -> tauri::Result<()> {',
    'fn create_source_window(app: &AppHandle, source: &str) -> tauri::Result<()> {',
    1,
)
old_open = '''fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
    let (label, _, _) = source_url(source)?;
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} 后台窗口尚未创建"))?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}
'''
new_open = '''fn open_source_impl(app: &AppHandle, source: &str) -> Result<(), String> {
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
if text.count(old_open) != 1:
    raise SystemExit('lib.rs: desktop open_source_impl anchor changed')
text = text.replace(old_open, new_open, 1)
main_builder_old = '''                .inner_size(1180.0, 820.0)
                .min_inner_size(820.0, 620.0)
                .initialization_script(EXTRACTOR_SCRIPT)
                .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
'''
main_builder_new = '''                .inner_size(1180.0, 820.0)
                .min_inner_size(820.0, 620.0)
                .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
'''
if text.count(main_builder_old) != 1:
    raise SystemExit('lib.rs: main window builder anchor changed')
text = text.replace(main_builder_old, main_builder_new, 1)
startup_sources = '''
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                create_source_window(app, "codex")?;
                create_source_window(app, "deepseek")?;
                create_source_window(app, "volcengine")?;
            }
'''
if text.count(startup_sources) != 1:
    raise SystemExit('lib.rs: eager source-window setup anchor changed')
text = text.replace(startup_sources, '\n', 1)
lib.write_text(text, encoding='utf-8')

# Restore the v0.6.2 direct PNG encoder path. A module Worker is unnecessary for
# startup and can destabilize older WebView2 runtimes before the dashboard is usable.
app = Path('web/app.js')
text = app.read_text(encoding='utf-8')
text = text.replace("const PNG_WORKER_TIMEOUT_MS = 30_000;\n", '', 1)
for line in [
    'let pngWorker = null;\n',
    'let pngWorkerFailed = false;\n',
    'let pngWorkerRequestId = 0;\n',
    'const pngWorkerRequests = new Map();\n',
]:
    if text.count(line) != 1:
        raise SystemExit(f'app.js: worker state anchor changed: {line.strip()}')
    text = text.replace(line, '', 1)
worker_start = text.index('function rejectWorkerRequests(error) {')
worker_end = text.index('async function renderAndStoreDashboard() {', worker_start)
text = text[:worker_start] + text[worker_end:]
old_encode = '  const png = await encodeDashboardPng(profile.width, profile.height, rgba);\n'
new_encode = '  const png = encodeGrayscalePng(profile.width, profile.height, rgbaToGrayscale(rgba));\n'
if text.count(old_encode) != 1:
    raise SystemExit('app.js: worker encoder call anchor changed')
text = text.replace(old_encode, new_encode, 1)
app.write_text(text, encoding='utf-8')
Path('web/png-worker.js').unlink(missing_ok=True)

# Update the v0.9.5 regression test so it preserves the refresh checks without
# requiring the removed Worker implementation.
test = Path('tests/long-running-sync-v095.test.mjs')
text = test.read_text(encoding='utf-8')
old_worker_test = '''test('PNG worker timeouts reject pending work and allow a new worker', () => {
  assert.match(app, /PNG_WORKER_TIMEOUT_MS = 30_000/);
  assert.match(app, /function resetPngWorker\\(error\\)/);
  assert.match(app, /PNG 后台线程超时，已自动重建/);
  assert.match(app, /clearTimeout\\(request\\.timer\\)/);
  assert.match(app, /result\\?\\.failed/);
});
'''
new_worker_test = '''test('partial refresh failures remain visible in the control center', () => {
  assert.match(app, /result\\?\\.failed/);
  assert.match(app, /已触发其余来源/);
});
'''
if text.count(old_worker_test) != 1:
    raise SystemExit('long-running-sync-v095 test anchor changed')
text = text.replace(old_worker_test, new_worker_test, 1)
test.write_text(text, encoding='utf-8')

# Add a dedicated startup regression test.
startup_test = Path('tests/main-window-startup-v096.test.mjs')
startup_test.write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const setup = rust.slice(rust.indexOf('.setup(move |app|'), rust.indexOf('.on_window_event', rust.indexOf('.setup(move |app|')));

test('main window startup does not construct provider WebViews', () => {
  assert.match(rust, /fn create_source_window\\(app: &AppHandle/);
  assert.match(rust, /create_source_window\\(app, source\\)/);
  assert.doesNotMatch(setup, /create_source_window/);
  assert.doesNotMatch(setup, /initialization_script\\(EXTRACTOR_SCRIPT\\)/);
  assert.equal((rust.match(/\\.initialization_script\\(EXTRACTOR_SCRIPT\\)/g) || []).length, 1);
});

test('provider creation failure is returned without terminating main setup', () => {
  assert.match(rust, /无法创建 \\{label\\} 数据源窗口/);
  assert.doesNotMatch(setup, /create_source_window\\([^)]*\\)\\?/);
});

test('dashboard PNG uses the v0.6.2 direct encoder path', () => {
  assert.doesNotMatch(app, /new Worker/);
  assert.doesNotMatch(app, /PNG_WORKER_TIMEOUT_MS/);
  assert.match(app, /encodeGrayscalePng\\(profile\\.width, profile\\.height, rgbaToGrayscale\\(rgba\\)\\)/);
});
''', encoding='utf-8')

# Update README release notes.
readme = Path('README.md')
text = readme.read_text(encoding='utf-8')
text = text.replace('当前稳定版：**v0.9.5**', '当前稳定版：**v0.9.6**', 1)
text = text.replace('/releases/tag/v0.9.5)', '/releases/tag/v0.9.6)', 1)
anchor = '## v0.9.5 长期运行稳定性修复\n'
section = '''## v0.9.6 主界面启动稳定性修复

- 主窗口不再依赖 Codex、DeepSeek 或火山方舟外部 WebView 创建成功。
- 三个数据源窗口改为首次点击时按需创建；单个页面创建失败只会显示来源错误，不会终止主程序。
- 主窗口不再注入仅供外部页面使用的采集脚本。
- PNG 生成恢复 v0.6.2 的直接编码路径，移除启动阶段的模块 Worker。

'''
if anchor not in text:
    raise SystemExit('README v0.9.5 anchor changed')
text = text.replace(anchor, section + anchor, 1)
readme.write_text(text, encoding='utf-8')
