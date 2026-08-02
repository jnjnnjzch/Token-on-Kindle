import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

test('local HTTP server exposes browser and image routes', () => {
  assert.match(rust, /"\/" \| "\/index\.html"/);
  assert.match(rust, /"\/dashboard\.png"/);
  assert.match(rust, /meta http-equiv=\"refresh\"/);
  assert.match(rust, /no-store, no-cache, must-revalidate/);
});

test('control center exposes browser URL and refresh input', () => {
  assert.match(html, /id="browser-url"/);
  assert.match(html, /id="refresh-minutes"/);
  assert.match(html, /id="save-refresh"/);
});
