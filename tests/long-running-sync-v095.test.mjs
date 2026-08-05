import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../web/volcengine-chart-reader.js', import.meta.url), 'utf8');
const base = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
const built = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('refresh attempts every source and reports partial failures', () => {
  assert.match(rust, /\("codex-login", "Codex", true\)/);
  assert.match(rust, /\("deepseek-login", "DeepSeek", true\)/);
  assert.match(rust, /\("volcengine-login", "火山方舟", false\)/);
  assert.match(rust, /failed\.push\(format!\("\{source_name\}：\{error\}"\)\)/);
  assert.match(rust, /Ok\(RefreshSummary \{ refreshed, failed \}\)/);
  assert.match(rust, /typeof window\.__TOKEN_ON_KINDLE_SYNC__ !== 'function'/);
  assert.doesNotMatch(rust, /window\.__TOKEN_ON_KINDLE_SYNC__\?\./);
});

test('Volcengine refreshes the current SPA controls and expires stale chart fallback', () => {
  assert.match(reader, /function triggerDataRefresh\(\)/);
  assert.match(reader, /\^\(查询\|刷新\|搜索\|更新\|query\|refresh\|search\|update\)\$/);
  assert.match(reader, /MAX_CACHED_CHART_AGE_MS = 90_000/);
  assert.match(reader, /cacheAgeMs > MAX_CACHED_CHART_AGE_MS/);
  assert.match(reader, /resetDomCache\(true\)/);
});

test('partial refresh failures remain visible in the control center', () => {
  assert.match(app, /result\?\.failed/);
  assert.match(app, /已触发其余来源/);
});

test('unused Volcengine full-response cache is absent from source and release extractor', () => {
  for (const source of [base, built]) {
    assert.doesNotMatch(source, /installVolcengineNetworkCapture/);
    assert.doesNotMatch(source, /__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__/);
  }
  assert.match(compose, /legacy Volcengine response cache remains active/);
});

test('hidden Volcengine WebView can still trigger the matched SPA refresh control', () => {
  assert.match(reader, /if \(!control\.isConnected\) continue/);
  assert.doesNotMatch(reader, /getBoundingClientRect/);
});
