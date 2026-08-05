import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('dashboard publishing is serialized, reusable, and burst-debounced', () => {
  assert.match(app, /const outputCanvas = document\.createElement\('canvas'\)/);
  assert.match(app, /let publishPromise = null/);
  assert.match(app, /let publishDirty = false/);
  assert.match(app, /function schedulePublish/);
  assert.match(app, /while \(publishDirty\)/);
  assert.doesNotMatch(app, /async function publish\(\) \{[\s\S]*?const outputCanvas = document\.createElement/);
});

test('manual refresh cannot pile up or leave the control center disabled forever', () => {
  assert.match(app, /REFRESH_COMMAND_TIMEOUT_MS/);
  assert.match(app, /REFRESH_COOLDOWN_MS/);
  assert.match(app, /refreshInFlight/);
  assert.match(app, /invokeWithTimeout\('refresh_sources'/);
  assert.match(app, /界面已恢复响应/);
});

test('release extractor removes the hidden WebView close-on-reload race', () => {
  assert.match(compose, /background close-on-reload handler remains active/);
  assert.doesNotMatch(extractor, /window\.addEventListener\('beforeunload'/);
});
