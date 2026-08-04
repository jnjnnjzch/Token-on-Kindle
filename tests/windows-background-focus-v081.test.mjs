import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');

test('background refresh never shows or focuses source windows', () => {
  assert.match(native, /fn background_refresh_window/);
  assert.match(native, /window\.is_focused\(\)\.unwrap_or\(false\)/);
  assert.match(native, /window\.eval\(&reload_script\)/);
  assert.match(native, /window\.eval\(&sync_script\)/);
  const refreshBlock = native.match(/fn background_refresh_window[\s\S]*?fn reload_sources/)?.[0] || '';
  assert.ok((refreshBlock.match(/window\.hide\(\)/g) || []).length >= 2);
  assert.doesNotMatch(refreshBlock, /window\.show\(\)|window\.set_focus\(\)/);
  assert.match(native, /background_refresh_window\(&window, true, refresh_minutes, &sync_requested_at\)/);
  assert.match(native, /background_refresh_window\(&window, false, refresh_minutes, &sync_requested_at\)/);
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
