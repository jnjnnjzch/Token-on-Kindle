import json
import os
import subprocess
from pathlib import Path

BRANCH = 'agent/deepseek-core-layout-v081'
ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_HEAD_REF') == BRANCH:
    subprocess.run(['git', 'fetch', 'origin', BRANCH], check=True)
    subprocess.run(['git', 'checkout', '-B', BRANCH, f'origin/{BRANCH}'], check=True)

lib_path = Path('src-tauri/src/lib.rs')
source = lib_path.read_text(encoding='utf-8')
old_reload = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reload_sources(app: &AppHandle) -> Result<(), String> {
    let mut refreshed = 0;
    for label in ["codex-login", "deepseek-login"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .eval("location.reload()")
                .map_err(|error| error.to_string())?;
            refreshed += 1;
        }
    }
    if let Some(window) = app.get_webview_window("volcengine-login") {
        window
            .eval("window.__TOKEN_ON_KINDLE_SYNC__?.({ automatic: true })")
            .map_err(|error| error.to_string())?;
        refreshed += 1;
    }
    if refreshed == 0 {
        return Err("没有可刷新的后台窗口".into());
    }
    Ok(())
}
'''
new_reload = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
'''
if old_reload in source:
    source = source.replace(old_reload, new_reload, 1)
elif 'fn background_refresh_window' not in source:
    raise SystemExit('reload_sources block not found')

old_dashboard = '''    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = window.hide();
        if let Some(main) = window.app_handle().get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
'''
new_dashboard = '''    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = window.hide();
    }
'''
if old_dashboard in source:
    source = source.replace(old_dashboard, new_dashboard, 1)
elif 'fn return_to_dashboard' not in source:
    raise SystemExit('return_to_dashboard block not found')
lib_path.write_text(source, encoding='utf-8')

def patch_extractor(path: Path) -> None:
    extractor = path.read_text(encoding='utf-8')
    old_hide = "    hide.onclick = () => { document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard'; };"
    new_hide = "    hide.onclick = () => window.close();"
    if old_hide in extractor:
        extractor = extractor.replace(old_hide, new_hide, 1)
    elif new_hide not in extractor:
        raise SystemExit(f'toolbar hide action not found in {path}')
    guard_anchor = "  const pageLines = () => clean(document.body?.innerText || '').split(/\\n+/).map(clean).filter(Boolean);\n"
    guard_code = "\n  window.addEventListener('beforeunload', () => {\n    if (!document.hasFocus()) {\n      try { window.close(); } catch { /* native window guard */ }\n    }\n  });\n"
    if 'native window guard' not in extractor:
        if guard_anchor not in extractor:
            raise SystemExit(f'extractor guard anchor not found in {path}')
        extractor = extractor.replace(guard_anchor, guard_anchor + guard_code, 1)
    path.write_text(extractor, encoding='utf-8')

patch_extractor(Path('web/extractor-base.js'))
patch_extractor(Path('web/extractor.js'))

Path('tests/windows-background-focus-v081.test.mjs').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');

test('background refresh never shows or focuses source windows', () => {
  assert.match(native, /fn background_refresh_window/);
  assert.match(native, /window\.is_focused\(\)\.unwrap_or\(false\)/);
  assert.match(native, /let _ = window\.hide\(\);[\s\S]*window\.eval\(script\)[\s\S]*let _ = window\.hide\(\);/);
  assert.match(native, /background_refresh_window\(&window, true\)/);
  assert.match(native, /background_refresh_window\(&window, false\)/);
  assert.equal((native.match(/\.set_focus\(\)/g) || []).length, 1);
});

test('hiding a source window does not summon the dashboard', () => {
  const returnBlock = native.match(/fn return_to_dashboard[\s\S]*?fn handle_title_signal/)?.[0] || '';
  assert.match(returnBlock, /window\.hide\(\)/);
  assert.doesNotMatch(returnBlock, /main\.show\(\)|main\.set_focus\(\)/);
  assert.match(extractor, /hide\.onclick = \(\) => window\.close\(\)/);
  assert.doesNotMatch(extractor, /__TOKEN_ON_KINDLE_ACTION__:dashboard/);
});

test('hidden WebViews request another hide before background navigation', () => {
  assert.match(extractor, /beforeunload/);
  assert.match(extractor, /!document\.hasFocus\(\)/);
  assert.match(extractor, /window\.close\(\)/);
});
''', encoding='utf-8')

if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_HEAD_REF') == BRANCH:
    package_path = Path('package.json')
    package = json.loads(package_path.read_text(encoding='utf-8'))
    prefix = 'python3 tools/apply-v081-focus-fix.py && '
    if package['scripts']['test'].startswith(prefix):
        package['scripts']['test'] = package['scripts']['test'][len(prefix):]
    package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    for path in [
        Path('.github/workflows/apply-v081-focus-fix.yml'),
        Path('.github/workflows/apply-v081-focus-fix-pr.yml'),
        Path('tools/apply-v081-focus-fix.py'),
    ]:
        path.unlink(missing_ok=True)

    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
    subprocess.run(['git', 'add', '-A'], check=True)
    subprocess.run(['git', 'commit', '-m', 'prevent Windows background windows from stealing focus'], check=True)
    subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'], check=True)
