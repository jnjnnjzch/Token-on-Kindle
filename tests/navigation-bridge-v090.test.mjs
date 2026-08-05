import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('source windows use a cancelled navigation as the primary native bridge', () => {
  assert.match(native, /NAVIGATION_BRIDGE_HOST: &str = "token-on-kindle\.invalid"/);
  assert.match(native, /\.on_navigation\(move \|url\| handle_navigation_bridge/);
  assert.match(native, /url\.host_str\(\) != Some\(NAVIGATION_BRIDGE_HOST\)/);
  assert.match(native, /\["signal", source, encoded\]/);
  assert.match(native, /\["action", "dashboard"\]/);
  assert.match(native, /false\n\}/);
});

test('generated extractor emits both navigation and title fallback signals', () => {
  assert.match(compose, /__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__/);
  assert.match(compose, /location\.assign\(url\)/);
  assert.match(extractor, /https:\/\/token-on-kindle\.invalid/);
  assert.match(extractor, /__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__\?\.\('signal', source, encoded\)/);
  assert.match(extractor, /__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__\?\.\('action', 'dashboard'\)/);
  assert.match(extractor, /__TOKEN_ON_KINDLE__:/);
});
