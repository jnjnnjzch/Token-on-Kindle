import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const desktop = fs.readFileSync(new URL('../web/desktop.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../web/png-worker.js', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('PNG compression runs off the control-center thread', () => {
  assert.match(app, /new Worker\(new URL\('\.\/png-worker\.js'/);
  assert.match(app, /let publishInFlight = null/);
  assert.match(app, /let publishQueued = false/);
  assert.match(app, /function schedulePublish/);
  assert.doesNotMatch(app, /requestAnimationFrame|publishDirty|publishPromise/);
  assert.match(worker, /encodeGrayscalePng/);
  assert.match(worker, /rgbaToGrayscale/);
  assert.match(worker, /postMessage\(\{ id, png: png\.buffer \}/);
});

test('manual refresh returns to the stable single-flight flow', () => {
  assert.match(app, /refreshInFlight/);
  assert.match(app, /await invoke\?\.\('refresh_sources'\)/);
  assert.doesNotMatch(app, /REFRESH_COMMAND_TIMEOUT_MS|REFRESH_COOLDOWN_MS|invokeWithTimeout/);
  assert.match(app, /正在重新载入数据源/);
});

test('tray updates are serialized and deduplicated before opening Kindle pages', () => {
  assert.match(desktop, /traySyncInFlight/);
  assert.match(desktop, /lastSourceStatus/);
  assert.match(desktop, /lastUpdateStatus/);
  assert.doesNotMatch(desktop, /Promise\.allSettled/);
  assert.match(desktop, /正在打开 Kindle 页面/);
});

test('release extractor removes the hidden WebView close-on-reload race', () => {
  assert.match(compose, /background close-on-reload handler remains active/);
  assert.doesNotMatch(extractor, /window\.addEventListener\('beforeunload'/);
});

test('source signals stay compact enough for the title bridge', () => {
  assert.match(compose, /const signalCompactor/);
  assert.match(compose, /compactDeepSeekModel/);
  assert.match(compose, /compactVolcengineModel/);
  assert.match(extractor, /__TOKEN_ON_KINDLE_COMPACT_SIGNAL__/);
  assert.match(extractor, /todayTokens/);
  assert.match(extractor, /cacheHitTokens/);
  assert.match(extractor, /totalTokens/);
});

test('source hide button uses the native dashboard action instead of closing the WebView', () => {
  assert.match(compose, /__TOKEN_ON_KINDLE_ACTION__:dashboard/);
  assert.match(extractor, /__TOKEN_ON_KINDLE_ACTION__:dashboard/);
  assert.doesNotMatch(extractor, /hide\.onclick = \(\) => window\.close\(\)/);
});

test('source toolbar no longer claims native receipt before the main window updates', () => {
  assert.match(extractor, /已发送至主程序，主界面收到后会更新/);
  assert.doesNotMatch(extractor, /已同步至 Kindle/);
});
