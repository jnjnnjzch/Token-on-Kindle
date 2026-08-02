import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

test('refresh interval is persisted and sent to the native scheduler', () => {
  assert.match(app, /token-on-kindle:refresh-minutes/);
  assert.match(app, /set_refresh_interval/);
  assert.match(app, /localStorage\.setItem\(REFRESH_STORAGE_KEY/);
});
