import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const releaseExtractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('background refresh reloads stateless sources but preserves the Volcengine view', () => {
  const refreshBlock = native.match(/fn reload_sources\(app: &AppHandle\)[\s\S]*?#\[cfg\(any/)?.[0] || '';
  assert.match(refreshBlock, /\("codex", "Codex", true\)/);
  assert.match(refreshBlock, /\("deepseek", "DeepSeek", true\)/);
  assert.match(refreshBlock, /\("volcengine", "火山方舟", false\)/);
  assert.match(native, /fn background_refresh_window/);
  assert.match(native, /if reload_page/);
  assert.match(native, /location\.reload\(\)/);
  assert.match(refreshBlock, /Err\(error\) => failed\.push/);
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
