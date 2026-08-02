import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticSnapshot } from '../web/diagnostics.js';

test('DeepSeek diagnostic summary keeps useful fields and removes noisy raw data', () => {
  const summary = diagnosticSnapshot('deepseek', {
    source: 'deepseek', capturedAt: '2026-08-02T08:31:25.126Z',
    range: { cost: null, requests: 1558, tokens: 239211413 },
    url: 'https://platform.deepseek.com/usage', balance: { value: 68.9 },
    todayTokens: { value: 64299835 },
    account: { cumulativeCost: 144.6, monthlyCost: 22.1, monthlyTokens: 500 },
    diagnostics: { chartCount: 5, visibleSummary: { lineCount: 77 }, parser: { source: 'platform-internal-api', attempts: [{ date: 'x' }], amountDayCount: 31 } }
  });
  assert.equal(summary.account.cumulativeCost, 144.6);
  assert.equal(summary.today.tokens, 64299835);
  assert.equal(summary.diagnostics.parser.amountDayCount, 31);
  assert.equal('range' in summary, false);
  assert.equal('url' in summary, false);
  assert.equal('visibleSummary' in summary.diagnostics, false);
  assert.equal('attempts' in summary.diagnostics.parser, false);
});
