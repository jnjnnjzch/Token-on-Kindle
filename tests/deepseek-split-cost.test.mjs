import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepSeekSummaryText } from '../shared/deepseek-summary-parser.mjs';

test('parses range cost when currency, amount, and unit are split across DOM lines', () => {
  const parsed = parseDeepSeekSummaryText(`
Time
Last 30 days
API Key
All
Cost
¥
26.23
CNY
API requests
1,532
Tokens
228,871,515
`);

  assert.equal(parsed.cost?.value, 26.23);
  assert.equal(parsed.requests?.value, 1532);
  assert.equal(parsed.tokens?.value, 228871515);
});

test('does not treat an unrelated bare number as money without a nearby currency marker', () => {
  const parsed = parseDeepSeekSummaryText(`
Cost
1,532
API requests
1,532
Tokens
228,871,515
`);

  assert.equal(parsed.cost, null);
});
