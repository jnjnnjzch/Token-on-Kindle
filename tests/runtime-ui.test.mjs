import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  KINDLE_LAYOUT,
  deepSeekRangeMetrics,
  selectCodexQuotas
} from '../web/kindle-renderer.js';

test('Codex weekly and 5h quotas are selected for one shared two-column card', () => {
  const weekly = { id: 'weekly', remainingPercent: 70 };
  const fiveHour = { id: '5h', remainingPercent: 42 };
  const daily = { id: 'daily', remainingPercent: 88 };
  assert.deepEqual(
    selectCodexQuotas({ quotas: [daily, fiveHour, weekly] }),
    { weekly, hourly: fiveHour }
  );
});

test('Codex falls back to a single available quota without inventing a second column', () => {
  const weekly = { id: 'weekly', remainingPercent: 70 };
  assert.deepEqual(selectCodexQuotas({ quotas: [weekly] }), { weekly, hourly: null });
});

test('DeepSeek summary follows the currently selected page range', () => {
  assert.deepEqual(
    deepSeekRangeMetrics({ range: { cost: 18.42, tokens: 923_000_000 } }),
    { rangeCost: 18.42, rangeTokens: 923_000_000 }
  );
  assert.deepEqual(
    deepSeekRangeMetrics({ account: { monthlyCost: 9, monthlyTokens: 10 } }),
    { rangeCost: null, rangeTokens: null }
  );
});

test('unlock background spans the full image and covers the complete firmware text area', () => {
  assert.equal(KINDLE_LAYOUT.width, 600);
  assert.equal(KINDLE_LAYOUT.unlockTop + KINDLE_LAYOUT.unlockHeight, KINDLE_LAYOUT.height);
  assert.ok(KINDLE_LAYOUT.unlockHeight >= 80);
});

test('Kindle output contains no refresh or connection-status copy', async () => {
  const source = await readFile(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /局域网网页与屏保图片已就绪/);
  assert.doesNotMatch(source, /自动更新/);
});
