import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('desktop source windows use the proven v0.8.2 title bridge', () => {
  assert.match(native, /\.on_document_title_changed\(\|window, title\| handle_title_signal/);
  assert.match(native, /fn handle_title_signal\(window: &WebviewWindow, title: &str\)/);
  assert.match(native, /store_metrics_signal\(&app, source, encoded\)/);
  assert.doesNotMatch(native, /NAVIGATION_BRIDGE_HOST|\.on_navigation\(|handle_navigation_bridge/);
});

test('generated extractor never closes native source windows during refresh', () => {
  assert.match(compose, /background close-on-reload handler remains active/);
  assert.match(extractor, /document\.title = `__TOKEN_ON_KINDLE__:\$\{source\}:\$\{encoded\}`/);
  assert.match(extractor, /document\.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard'/);
  assert.doesNotMatch(extractor, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(extractor, /hide\.onclick = \(\) => window\.close\(\)/);
  assert.doesNotMatch(extractor, /__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__|token-on-kindle\.invalid|location\.assign\(/);
});

test('compact payloads remain enabled on all title transports', () => {
  assert.match(extractor, /__TOKEN_ON_KINDLE_COMPACT_SIGNAL__/);
  assert.match(extractor, /const encoded = encodeSignal\(payload\)/);
  assert.match(extractor, /__TOKEN_ON_KINDLE__:deepseek:\$\{encoded\}/);
  assert.match(extractor, /__TOKEN_ON_KINDLE__:volcengine:\$\{encodeSignal\(payload\)\}/);
});
