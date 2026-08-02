import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('Kindle browser page busts cached dashboard images', () => {
  assert.match(rust, /dashboard\.png\?v=\{nonce\}/);
  assert.match(rust, /must-revalidate, max-age=0/);
});
