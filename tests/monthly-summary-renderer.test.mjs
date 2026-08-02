import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');

test('Kindle summary displays monthly cost and monthly tokens', () => {
  assert.match(renderer, /export function deepSeekMonthlyMetrics/);
  assert.match(renderer, /deepseek\?\.account\?\.monthlyCost/);
  assert.match(renderer, /deepseek\?\.account\?\.monthlyTokens/);
  assert.match(renderer, /\['本月费用', formatMoney\(monthly\.monthlyCost\)\]/);
  assert.match(renderer, /\['本月 Token', formatTokens\(monthly\.monthlyTokens\)\]/);
});

test('selected-range values are no longer used by the visible DeepSeek summary', () => {
  assert.doesNotMatch(renderer, /\['筛选范围费用'/);
  assert.doesNotMatch(renderer, /\['筛选范围 Token'/);
  assert.match(renderer, /function drawMonthlyFallback/);
  assert.match(renderer, /本月 API 请求/);
});
