import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheRateToRatio } from '../web/kindle-renderer.js';

test('model cache bars use the displayed cache percentage', () => {
  assert.equal(cacheRateToRatio(75), 0.75);
  assert.equal(cacheRateToRatio({ value: 83.3 }), 0.833);
  assert.equal(cacheRateToRatio(0), 0);
  assert.equal(cacheRateToRatio(null), 0);
});

test('cache bar ratios are clamped to the visible range', () => {
  assert.equal(cacheRateToRatio(-5), 0);
  assert.equal(cacheRateToRatio(120), 1);
});
