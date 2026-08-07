import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../web/volcengine-direct-reader.js', import.meta.url), 'utf8');
const base = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
const built = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('refresh attempts every source and reports partial failures', () => {
  assert.match(rust, /\("codex", "Codex", true\)/);
  assert.match(rust, /\("deepseek", "DeepSeek", true\)/);
  assert.match(rust, /\("volcengine", "火山方舟", false\)/);
  assert.match(rust, /failed\.push\(format!\("\{source_name\}：\{error\}"\)\)/);
  assert.match(rust, /Ok\(RefreshSummary \{ refreshed, failed \}\)/);
  assert.match(rust, /typeof window\.__TOKEN_ON_KINDLE_SYNC__ === 'function'/);
});

test('Volcengine long-running refresh uses the lightweight session API worker', () => {
  assert.match(reader, /\/robots\.txt#token-on-kindle-api-worker/);
  assert.match(reader, /function replayTemplate\(action\)/);
  assert.match(reader, /credentials:\s*'include'/);
  assert.match(reader, /cache:\s*'no-store'/);
  assert.match(reader, /location\.reload\(\)/);
  assert.match(reader, /location\.replace\(WORKER_URL\)/);
  assert.match(reader, /v0\.6\.2-reload-worker/);
  assert.doesNotMatch(reader, /triggerDataRefresh|getEchartsInstance|模型调用明细|usageCard/);
});

test('partial refresh failures remain visible in the control center', () => {
  assert.match(app, /result\?\.failed/);
  assert.match(app, /已触发其余来源/);
});

test('unused Volcengine response and DOM caches are absent from release extractor', () => {
  for (const source of [built, reader]) {
    assert.doesNotMatch(source, /__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__/);
    assert.doesNotMatch(source, /getEchartsInstance|volcengineModelsFromDom|collectVolcengineWindow/);
  }
  assert.match(compose, /legacy Volcengine response cache remains active/);
  assert.match(compose, /Volcengine DOM fallback remains in production build/);
  assert.match(base, /collectVolcengineWindow/);
});

test('worker exposes an in-page sync hook without requiring visible SPA controls', () => {
  assert.match(reader, /window\.__TOKEN_ON_KINDLE_SYNC__\s*=/);
  assert.doesNotMatch(reader, /getBoundingClientRect|\.isConnected/);
});
