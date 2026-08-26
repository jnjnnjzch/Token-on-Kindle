import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { TextEncoder } from 'node:util';
import { selectCodexQuotas } from '../web/kindle-renderer.js';

function loadCodexHooks() {
  const reader = fs.readFileSync(new URL('../web/codex-direct-reader.js', import.meta.url), 'utf8');
  const window = { addEventListener() {} };
  const context = {
    location: { hostname: 'chatgpt.com', href: 'https://chatgpt.com/codex/cloud/settings/analytics' },
    window,
    document: {
      readyState: 'loading',
      visibilityState: 'visible',
      addEventListener() {}
    },
    sessionStorage: {
      getItem() { return null; },
      setItem() {}
    },
    TextEncoder,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  vm.runInNewContext(reader, context, { filename: 'codex-direct-reader.js' });
  return { hooks: window.__TOKEN_ON_KINDLE_CODEX_TEST__, reader };
}

test('Codex recognizes compact and expanded 5-hour window labels without treating reset durations as quota windows', () => {
  const { hooks } = loadCodexHooks();
  assert.ok(hooks);
  for (const label of ['5h limit', '5-hour limit', '5 hours limit', '5 hrs quota', '5小时额度']) {
    assert.equal(hooks.quotaKind(label), '5h', label);
  }
  assert.equal(hooks.quotaKind('Weekly limit'), 'weekly');
  assert.equal(hooks.quotaKind('Resets in 2h 14m'), 'unknown');
  assert.equal(hooks.quotaKind('2小时后重置'), 'unknown');
  assert.equal(Array.from(hooks.quotaKinds('5h limit | 23% used | Resets in 2h 14m')).join(','), '5h');
});

test('Codex keeps the current percentage semantics and reset text together', () => {
  const { hooks } = loadCodexHooks();
  const hourly = hooks.quotaFromContext('5h limit | 23% used | Resets in 2h 14m');
  assert.equal(hourly.id, '5h');
  assert.equal(hourly.usedPercent, 23);
  assert.equal(hourly.remainingPercent, 77);
  assert.equal(hourly.resetText, '2h 14m');

  const weekly = hooks.quotaFromContext('Weekly limit | 61% remaining | Resets on Aug 30, 2026 at 4:00 PM');
  assert.equal(weekly.id, 'weekly');
  assert.equal(weekly.remainingPercent, 61);
  assert.equal(weekly.usedPercent, 39);
  assert.match(weekly.resetText, /Aug 30, 2026/);
});

test('Codex line collector binds 5h and weekly reset text to separate blocks', () => {
  const { hooks } = loadCodexHooks();
  const quotas = hooks.collectQuotasFromLines([
    '5h limit',
    '23% used',
    'Resets in 2h 14m',
    'Weekly limit',
    '61% remaining',
    'Resets on Aug 30, 2026 at 4:00 PM'
  ]);
  const hourly = quotas.find(item => item.id === '5h');
  const weekly = quotas.find(item => item.id === 'weekly');
  assert.ok(hourly);
  assert.ok(weekly);
  assert.equal(hourly.resetText, '2h 14m');
  assert.match(weekly.resetText, /Aug 30, 2026/);
  assert.notEqual(weekly.resetText, hourly.resetText);
});

test('Codex refuses a mixed parent context instead of copying one reset across quota windows', () => {
  const { hooks } = loadCodexHooks();
  const mixed = hooks.quotaFromContext('5h limit | 23% used | Resets in 2h 14m | Weekly limit | 61% remaining | Resets on Aug 30, 2026');
  assert.equal(mixed, null);
});

test('Codex candidate merge prefers a candidate with reset metadata', () => {
  const { hooks } = loadCodexHooks();
  const weak = { id: '5h', displayedPercent: 23, remainingPercent: null, usedPercent: null, resetText: null, _score: 10 };
  const rich = { id: '5h', displayedPercent: 23, remainingPercent: 77, usedPercent: 23, resetText: '2h 14m', _score: 28 };
  const merged = hooks.mergeQuota(weak, rich);
  assert.equal(merged.id, '5h');
  assert.equal(merged.displayedPercent, 23);
  assert.equal(merged.remainingPercent, 77);
  assert.equal(merged.usedPercent, 23);
  assert.equal(merged.resetText, '2h 14m');
  assert.equal(merged._score, 28);
});

test('Kindle renderer selects the adaptive 5h quota and independent weekly reset text', () => {
  const { hourly, weekly } = selectCodexQuotas({
    quotas: [
      { id: '5h', remainingPercent: 77, resetText: '2h 14m' },
      { id: 'weekly', remainingPercent: 61, resetText: 'Aug 30' }
    ]
  });
  assert.equal(hourly.id, '5h');
  assert.equal(hourly.resetText, '2h 14m');
  assert.equal(weekly.id, 'weekly');
  assert.equal(weekly.resetText, 'Aug 30');
});

test('Codex background collector is short lived without a continuous DOM observer', () => {
  const { reader } = loadCodexHooks();
  const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
  assert.match(reader, /short-lived-hidden-worker/);
  assert.match(reader, /document\.visibilityState !== 'hidden'/);
  assert.match(reader, /window\.close\(\)/);
  assert.doesNotMatch(reader, /new MutationObserver/);
  assert.match(compose, /window\.__TOKEN_ON_KINDLE_SYNC__\?\.\(\{ automatic: true, startup: true \}\)/);
  assert.match(compose, /codex-adaptive-v0\.9\.17/);
});

test('native desktop layer really disposes Codex instead of converting close into hide', () => {
  const desktop = fs.readFileSync(new URL('../src-tauri/src/desktop.rs', import.meta.url), 'utf8');
  assert.match(desktop, /if window\.label\(\) == "codex" \{\s*return;\s*\}/);
  const codexGuard = desktop.indexOf('if window.label() == "codex"');
  const preventClose = desktop.indexOf('api.prevent_close()', codexGuard);
  assert.ok(codexGuard >= 0);
  assert.ok(preventClose > codexGuard, 'prevent_close must only run after the Codex early return');
});

test('native refresh recreates a disposed Codex WebView before the next collection', () => {
  const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(native, /fn ensure_source_window[\s\S]*get_webview_window\(label\)[\s\S]*create_source_window\(app, source\)/);
  assert.match(native, /for \(source, source_name, reload_page\) in \[[\s\S]*\("codex", "Codex", true\)/);
  assert.match(native, /let \(window, created\) = match ensure_source_window\(app, source\)/);
  assert.match(native, /if created \{[\s\S]*refreshed\.push\(format!\("\{source_name\}（已启动）"\)\)/);
});
