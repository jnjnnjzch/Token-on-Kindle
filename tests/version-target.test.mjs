import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('DeepSeek cost-card hotfix targets v0.5.3', () => {
  assert.equal(pkg.version, '0.5.3');
});
