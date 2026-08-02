import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('layout release targets v0.5.1', () => {
  assert.equal(pkg.version, '0.5.1');
});
