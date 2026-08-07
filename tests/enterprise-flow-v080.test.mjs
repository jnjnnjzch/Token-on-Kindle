import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../web/volcengine-direct-reader.js', import.meta.url), 'utf8');

test('enterprise Agent Plan capture is explicitly anchored to the AFP usage view', () => {
  for (const label of ['近5小时用量', '近一周用量', '近一月用量']) assert.match(extractor, new RegExp(label));
  assert.match(extractor, /同步至 Kindle/);
  assert.match(extractor, /sync\.onclick = \(\) => collectAndSignal\(\{ manual: true \}\)/);
  assert.match(extractor, /__TOKEN_ON_KINDLE_SYNC__/);
  assert.match(extractor, /volcengine\.com/);
  assert.match(extractor, /windows/);
});

test('enterprise background refresh reloads the lightweight API worker in the shared native batch', () => {
  const refreshBlock = native.match(/fn reload_sources\(app: &AppHandle\)[\s\S]*?#\[cfg\(any/)?.[0] || '';
  assert.match(refreshBlock, /\("codex", "Codex", true\)/);
  assert.match(refreshBlock, /\("deepseek", "DeepSeek", true\)/);
  assert.match(refreshBlock, /\("volcengine", "火山方舟", true\)/);
  assert.doesNotMatch(refreshBlock, /\("volcengine", "火山方舟", false\)/);
  assert.match(refreshBlock, /reload_page/);
  assert.match(reader, /\/robots\.txt#token-on-kindle-api-worker/);
  assert.match(reader, /runWorkerSync\(\{ \.\.\.options, automatic: true, startup: true \}\)/);
});

test('source selection is only Codex, DeepSeek, and Volcengine', () => {
  for (const id of ['display-codex', 'display-deepseek', 'display-volcengine']) assert.match(index, new RegExp(id));
  assert.doesNotMatch(index, /display-deepseek-flash|display-deepseek-pro/);
  assert.match(app, /codex: true, deepseek: true, volcengine: true/);
});
