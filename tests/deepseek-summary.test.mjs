import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepSeekSummaryText } from '../shared/deepseek-summary-parser.mjs';

test('reads the visible DeepSeek summary cards from the current Usage page', () => {
  const result = parseDeepSeekSummaryText(`
Overview
Cost
¥47.09
API requests
1,367
Tokens
178,767,054
Usage
Cost(CNY)
2026-07-04
2026-08-02
deepseek-v4-flash
API requests 399
Tokens 47,917,935
`);

  assert.equal(result.cost.value, 47.09);
  assert.equal(result.requests.value, 1367);
  assert.equal(result.tokens.value, 178_767_054);
});

test('does not confuse model-section totals with the top summary cards', () => {
  const result = parseDeepSeekSummaryText(`
Cost
¥47.09
API requests
1,367
Tokens
178,767,054
deepseek-v4-flash
API requests
399
Tokens
47,917,935
deepseek-v4-pro
API requests
221
Tokens
70,310,261
`);

  assert.equal(result.requests.value, 1367);
  assert.equal(result.tokens.value, 178_767_054);
});
