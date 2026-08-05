import test from 'node:test';
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
