import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const reader = fs.readFileSync(new URL('../web/volcengine-direct-reader.js', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('Volcengine bootstraps on the Agent Plan Enterprise route', () => {
  assert.match(rust, /const VOLCENGINE_URL: &str\s*=\s*"https:\/\/console\.volcengine\.com\/ark\/region:cn-beijing\/subscription\/agent-plan-enterprise";/);
  assert.match(reader, /const ENTERPRISE_URL = 'https:\/\/console\.volcengine\.com\/ark\/region:cn-beijing\/subscription\/agent-plan-enterprise';/);
});

test('after bootstrap the WebView leaves the enterprise UI for a lightweight same-origin worker', () => {
  assert.match(reader, /const WORKER_URL = 'https:\/\/console\.volcengine\.com\/robots\.txt#token-on-kindle-api-worker';/);
  assert.match(reader, /location\.replace\(WORKER_URL\)/);
  assert.match(reader, /后台窗口仅保留控制台登录会话，不加载企业版用量界面/);
  assert.doesNotMatch(reader, /collectWindow|usageCard|readModelChart|_echarts_instance_/);
});

test('background sync uses the v0.6.2 reload lifecycle on the worker page', () => {
  assert.match(reader, /function queueReload\(options = \{\}\)/);
  assert.match(reader, /location\.reload\(\)/);
  assert.match(reader, /if \(isWorkerPage\(\) && !options\.reloadPass && !options\.startup\)/);
  assert.match(reader, /lifecycle:\s*'v0\.6\.2-reload-worker'/);
  assert.doesNotMatch(reader, /setInterval\(/);
});

test('opening the Volcengine source window enters the real login page', () => {
  assert.match(reader, /window\.addEventListener\('focus'/);
  assert.match(reader, /location\.replace\(ENTERPRISE_URL\)/);
});

test('the packaged extractor exposes the direct sync hook', () => {
  assert.match(extractor, /window\.__TOKEN_ON_KINDLE_SYNC__\s*=\s*directSync/);
  assert.match(extractor, /GetAgentPlanSeatUsageDetails/);
});
