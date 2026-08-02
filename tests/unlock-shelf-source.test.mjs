import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');

test('unlock area is a slim gray shelf instead of a full black block', () => {
  assert.match(renderer, /unlock: '#565656'/);
  assert.match(renderer, /const y = 756/);
  assert.doesNotMatch(renderer, /fillRect\(0, 720, 600, 80\)/);
});
