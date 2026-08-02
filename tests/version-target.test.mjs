import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('desktop integration release targets v0.6.1', () => {
  assert.equal(pkg.version, '0.6.1');
});
