import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('scheduler is woken when refresh interval changes', () => {
  assert.match(rust, /Condvar/);
  assert.match(rust, /changed\.notify_all\(\)/);
  assert.match(rust, /wait_timeout/);
});
