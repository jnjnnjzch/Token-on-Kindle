from pathlib import Path

lib_path = Path('src-tauri/src/lib.rs')
lib = lib_path.read_text(encoding='utf-8')
old_refresh = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reload_sources(app: &AppHandle) -> Result<(), String> {
    let mut refreshed = 0;
    for label in ["codex-login", "deepseek-login", "volcengine-login"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .eval("location.reload()")
                .map_err(|error| error.to_string())?;
            refreshed += 1;
        }
    }
    if refreshed == 0 {
        return Err("没有可刷新的后台窗口".into());
    }
    Ok(())
}
'''
new_refresh = '''#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn background_refresh_window(
    window: &WebviewWindow,
    reload_page: bool,
    refresh_minutes: u64,
    sync_requested_at: &str,
) -> Result<(), String> {
    let sync_script = format!(
        "window.__TOKEN_ON_KINDLE_SYNC__?.({{ automatic: true, refreshMinutes: {refresh_minutes}, syncRequestedAt: \\\"{sync_requested_at}\\\" }})"
    );
    if window.is_focused().unwrap_or(false) {
        return window.eval(&sync_script).map_err(|error| error.to_string());
    }

    let _ = window.hide();
    if reload_page {
        let reload_script = format!(
            "sessionStorage.setItem('__token_on_kindle_refresh_minutes', '{refresh_minutes}');sessionStorage.setItem('__token_on_kindle_sync_requested_at', '{sync_requested_at}');window.blur();location.reload()"
        );
        window.eval(&reload_script).map_err(|error| error.to_string())?;
    } else {
        window.eval(&sync_script).map_err(|error| error.to_string())?;
    }
    let _ = window.hide();
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reload_sources(app: &AppHandle) -> Result<(), String> {
    let refresh_minutes = app.state::<AppState>().refresh.get();
    let sync_requested_at = timestamp();
    let mut refreshed = 0;
    for label in ["codex-login", "deepseek-login"] {
        if let Some(window) = app.get_webview_window(label) {
            background_refresh_window(&window, true, refresh_minutes, &sync_requested_at)?;
            refreshed += 1;
        }
    }
    if let Some(window) = app.get_webview_window("volcengine-login") {
        background_refresh_window(&window, false, refresh_minutes, &sync_requested_at)?;
        refreshed += 1;
    }
    if refreshed == 0 {
        return Err("没有可刷新的后台窗口".into());
    }
    Ok(())
}
'''
if old_refresh not in lib:
    raise SystemExit('current reload_sources block not found')
lib_path.write_text(lib.replace(old_refresh, new_refresh, 1), encoding='utf-8')

Path('tests/dynamic-layout-sync-v082.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { balancedVerticalFlow, deepSeekLayoutPlan } from '../web/kindle-renderer.js';

const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('balanced vertical flow keeps internal gaps equal and bounded', () => {
  const compact = balancedVerticalFlow(160, [15, 38, 39, 24], { padding: 7, minGap: 4, maxGap: 11 });
  assert.ok(compact.gap >= 4 && compact.gap <= 11);
  const positions = compact.positions;
  const gaps = positions.slice(1).map((position, index) => position - positions[index] - [15, 38, 39][index]);
  gaps.forEach(gap => assert.ok(Math.abs(gap - compact.gap) < 0.001));

  const spacious = balancedVerticalFlow(420, [17, 46, 45, 27], { padding: 9, minGap: 6, maxGap: 18 });
  assert.equal(spacious.gap, 18);
  assert.ok(spacious.offset > 9, 'surplus space should center the content group instead of creating one giant gap');
});

test('DeepSeek summary and model sections adapt across all card heights', () => {
  const compact = deepSeekLayoutPlan(294);
  const medium = deepSeekLayoutPlan(348);
  const full = deepSeekLayoutPlan(584);
  assert.deepEqual(compact, { bodyHeight: 250, summaryHeight: 85, sectionGap: 8, modelHeight: 157 });
  assert.ok(medium.summaryHeight > compact.summaryHeight);
  assert.ok(medium.modelHeight > compact.modelHeight);
  assert.equal(full.summaryHeight, 112);
  assert.ok(full.modelHeight > 400);
  assert.match(renderer, /balancedVerticalFlow\(cellHeight/);
  assert.match(renderer, /balancedVerticalFlow\(height, \[headerHeight, totalHeight, breakdownHeight, cacheHeight\]/);
});

test('all sources share one native refresh batch and no page owns a recurring timer', () => {
  assert.doesNotMatch(extractor, /UPDATE_MS|setInterval\(\(\) => collectAndSignal/);
  assert.match(extractor, /updateIntervalMinutes: syncState\.refreshMinutes/);
  assert.match(extractor, /syncRequestedAt: syncState\.syncRequestedAt/);
  assert.match(extractor, /const marker = location\.href;/);
  assert.doesNotMatch(extractor, /document\.body\?\.innerText\?\.length/);

  const refreshBlock = native.match(/fn reload_sources\(app: &AppHandle\)[\s\S]*?#\[cfg\(any/)?.[0] || '';
  assert.match(refreshBlock, /\["codex-login", "deepseek-login"\]/);
  assert.match(refreshBlock, /background_refresh_window\(&window, true, refresh_minutes, &sync_requested_at\)\?/);
  assert.match(refreshBlock, /background_refresh_window\(&window, false, refresh_minutes, &sync_requested_at\)\?/);
  assert.match(extractor, /window\.__TOKEN_ON_KINDLE_SYNC__/);
  assert.match(renderer, /syncRequestedAt \|\| state\[source\]\?\.capturedAt/);
});
''', encoding='utf-8')

Path('tests/enterprise-flow-v080.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('enterprise Agent Plan capture is explicitly anchored to the AFP usage view', () => {
  for (const label of ['近5小时用量', '近一周用量', '近一月用量']) assert.match(extractor, new RegExp(label));
  assert.match(extractor, /同步至 Kindle/);
  assert.match(extractor, /sync\.onclick = \(\) => collectAndSignal\(\{ manual: true \}\)/);
  assert.match(extractor, /__TOKEN_ON_KINDLE_SYNC__/);
  assert.match(extractor, /volcengine\.com/);
  assert.match(extractor, /windows/);
});

test('enterprise background refresh preserves the confirmed SPA view in the shared native batch', () => {
  const refreshBlock = native.match(/fn reload_sources\(app: &AppHandle\)[\s\S]*?#\[cfg\(any/)?.[0] || '';
  assert.match(refreshBlock, /for label in \["codex-login", "deepseek-login"\]/);
  assert.match(refreshBlock, /background_refresh_window\(&window, true, refresh_minutes, &sync_requested_at\)\?/);
  assert.match(refreshBlock, /get_webview_window\("volcengine-login"\)/);
  assert.match(refreshBlock, /background_refresh_window\(&window, false, refresh_minutes, &sync_requested_at\)\?/);
  const volcengineBlock = refreshBlock.slice(refreshBlock.indexOf('get_webview_window("volcengine-login")'));
  assert.doesNotMatch(volcengineBlock, /location\.reload\(\)/);
});

test('source selection is only Codex, DeepSeek, and Volcengine', () => {
  for (const id of ['display-codex', 'display-deepseek', 'display-volcengine']) assert.match(index, new RegExp(id));
  assert.doesNotMatch(index, /display-deepseek-flash|display-deepseek-pro/);
  assert.match(app, /codex: true, deepseek: true, volcengine: true/);
});
''', encoding='utf-8')

Path('tests/windows-background-focus-v081.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const releaseExtractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('background refresh reloads stateless sources but preserves the Volcengine view', () => {
  const refreshBlock = native.match(/fn reload_sources\(app: &AppHandle\)[\s\S]*?#\[cfg\(any/)?.[0] || '';
  assert.match(refreshBlock, /\["codex-login", "deepseek-login"\]/);
  assert.match(native, /fn background_refresh_window/);
  assert.match(native, /if reload_page/);
  assert.match(native, /location\.reload\(\)/);
  assert.match(refreshBlock, /background_refresh_window\(&window, false, refresh_minutes, &sync_requested_at\)\?/);
});

test('hiding a source window does not summon the dashboard', () => {
  const returnBlock = native.match(/fn return_to_dashboard[\s\S]*?fn handle_title_signal/)?.[0] || '';
  assert.match(returnBlock, /window\.hide\(\)/);
  assert.doesNotMatch(returnBlock, /main\.show\(\)|main\.set_focus\(\)/);
  assert.match(extractor, /hide\.onclick = \(\) => window\.close\(\)/);
  assert.doesNotMatch(extractor, /__TOKEN_ON_KINDLE_ACTION__:dashboard/);
});

test('release extractor contains no close-on-reload handler', () => {
  assert.doesNotMatch(releaseExtractor, /window\.addEventListener\('beforeunload'/);
});
''', encoding='utf-8')

Path('tests/volcengine-sticky-refresh-v094.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('Volcengine opens on the Agent Plan Enterprise route', () => {
  assert.match(rust, /const VOLCENGINE_URL: &str = "https:\/\/console\.volcengine\.com\/ark\/region:cn-beijing\/subscription\/agent-plan-enterprise";/);
});

test('desktop refresh preserves the selected Volcengine SPA view', () => {
  assert.match(rust, /for label in \["codex-login", "deepseek-login"\]/);
  assert.match(rust, /background_refresh_window\(&window, true, refresh_minutes, &sync_requested_at\)\?/);
  assert.match(rust, /get_webview_window\("volcengine-login"\)/);
  assert.match(rust, /background_refresh_window\(&window, false, refresh_minutes, &sync_requested_at\)\?/);
  const start = rust.indexOf('if let Some(window) = app.get_webview_window("volcengine-login")');
  const end = rust.indexOf('if refreshed == 0', start);
  const volcengineBlock = rust.slice(start, end);
  assert.ok(volcengineBlock.length > 0);
  assert.doesNotMatch(volcengineBlock, /location\.reload\(\)/);
});

test('the extractor still exposes an in-page sync hook', () => {
  assert.match(extractor, /window\.__TOKEN_ON_KINDLE_SYNC__\s*=\s*/);
});
''', encoding='utf-8')
