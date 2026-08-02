import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KINDLE_LAYOUT } from '../web/kindle-renderer.js';

const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');

test('unlock area is a full-width gray firmware-safe band', () => {
  assert.equal(KINDLE_LAYOUT.unlockTop, 716);
  assert.equal(KINDLE_LAYOUT.unlockHeight, 84);
  assert.equal(KINDLE_LAYOUT.unlockTop + KINDLE_LAYOUT.unlockHeight, 800);
  assert.match(renderer, /unlock: '#565656'/);
  assert.match(renderer, /fillRect\(0, KINDLE_LAYOUT\.unlockTop, KINDLE_LAYOUT\.width, KINDLE_LAYOUT\.unlockHeight\)/);
  assert.doesNotMatch(renderer, /quadraticCurveTo/);
});
