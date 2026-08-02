import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const release = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('CI owns pull request Windows builds', () => {
  assert.match(ci, /pull_request:/);
  assert.match(ci, /Windows portable EXE/);
});

test('release workflow only runs for tags or manual dispatch', () => {
  assert.match(release, /tags: \['v\*'\]/);
  assert.doesNotMatch(release, /pull_request:/);
  assert.doesNotMatch(release, /branches: \[main\]/);
});
