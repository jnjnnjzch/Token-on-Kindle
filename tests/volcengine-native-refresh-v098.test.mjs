import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('all desktop sources use the native hidden-WebView reload path', () => {
  const refreshStart = rust.indexOf('fn reload_sources(app: &AppHandle)');
  const refreshEnd = rust.indexOf('#[cfg(any(target_os = "android"', refreshStart);
  const refresh = rust.slice(refreshStart, refreshEnd);

  assert.match(refresh, /\("codex", "Codex", true\)/);
  assert.match(refresh, /\("deepseek", "DeepSeek", true\)/);
  assert.match(refresh, /\("volcengine", "火山方舟", true\)/);
  assert.doesNotMatch(refresh, /\("volcengine", "火山方舟", false\)/);
});

test('native refresh preserves metadata and reloads the document', () => {
  const functionStart = rust.indexOf('fn background_refresh_window(');
  const functionEnd = rust.indexOf('fn reload_sources(app: &AppHandle)', functionStart);
  const implementation = rust.slice(functionStart, functionEnd);

  assert.match(implementation, /__token_on_kindle_refresh_minutes/);
  assert.match(implementation, /__token_on_kindle_sync_requested_at/);
  assert.match(implementation, /location\.reload\(\)/);
});
