import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepSeekPlatformPayloads } from '../shared/deepseek-platform-parser.mjs';

const wrap = biz_data => ({ code: 0, data: { biz_code: 0, biz_data } });

const summaryBody = wrap({
  normal_wallets: [{ currency: 'CNY', balance: '68.99' }],
  bonus_wallets: [],
  total_costs: [{ currency: 'CNY', amount: '144.01' }],
  monthly_costs: [],
  monthly_token_usage: null,
  total_usage: null
});

const amountBody = wrap({
  total: [],
  days: [
    {
      date: '2026-08-01',
      data: [
        {
          model: 'deepseek-v4-flash',
          usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '1000' },
            { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '100' },
            { type: 'RESPONSE_TOKEN', amount: '50' },
            { type: 'REQUEST', amount: '4' }
          ]
        }
      ]
    },
    {
      date: '2026-08-02',
      data: [
        {
          model: 'deepseek-v4-pro',
          usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '2000' },
            { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '200' },
            { type: 'RESPONSE_TOKEN', amount: '80' },
            { type: 'REQUEST', amount: '6' }
          ]
        },
        {
          model: 'deepseek-chat & deepseek-reasoner',
          usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '300' },
            { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '30' },
            { type: 'RESPONSE_TOKEN', amount: '20' },
            { type: 'REQUEST', amount: '2' }
          ]
        }
      ]
    }
  ]
});

const costBody = wrap([{
  currency: 'CNY',
  total: [],
  days: [
    {
      date: '2026-08-01',
      data: [{
        model: 'deepseek-v4-flash',
        usage: [
          { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '0.10' },
          { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '0.20' },
          { type: 'RESPONSE_TOKEN', amount: '0.30' }
        ]
      }]
    },
    {
      date: '2026-08-02',
      data: [
        {
          model: 'deepseek-v4-pro',
          usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '0.40' },
            { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '0.50' },
            { type: 'RESPONSE_TOKEN', amount: '0.60' }
          ]
        },
        {
          model: 'deepseek-chat & deepseek-reasoner',
          usage: [{ type: 'RESPONSE_TOKEN', amount: '0.70' }]
        }
      ]
    }
  ]
}]);

test('sums the whole month from daily internal API buckets when summary monthly fields are absent', () => {
  const result = parseDeepSeekPlatformPayloads({
    summaryBody,
    amountBody,
    costBody,
    now: new Date('2026-08-02T16:00:00+08:00')
  });

  assert.equal(result.account.monthlyTokens, 3780);
  assert.equal(result.account.monthlyRequests, 12);
  assert.ok(Math.abs(result.account.monthlyCost - 2.8) < 1e-12);
  assert.deepEqual(result.diagnostics.monthlyAggregation, {
    cost: 'summed-days',
    tokens: 'summed-days',
    requests: 'summed-days'
  });
});

test('monthly totals include models outside the two daily display cards', () => {
  const result = parseDeepSeekPlatformPayloads({ summaryBody, amountBody, costBody });
  assert.equal(result.account.monthlyTokens, 3780);
  assert.ok(result.account.monthlyCost > (result.models.flash.cost || 0) + (result.models.pro.cost || 0));
});
