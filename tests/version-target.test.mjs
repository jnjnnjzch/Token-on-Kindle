import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('updater and tray reliability release targets v0.6.2', () => {
  assert.equal(pkg.version, '0.6.2');
});
