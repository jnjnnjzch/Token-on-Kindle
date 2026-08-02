import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepSeekPlatformPayloads } from '../shared/deepseek-platform-parser.mjs';

const summaryBody = {
  code: 0,
  data: {
    biz_code: 0,
    biz_data: {
      normal_wallets: [{ currency: 'CNY', balance: '72.91' }],
      bonus_wallets: [{ currency: 'CNY', balance: '1.00' }],
      total_costs: [{ currency: 'CNY', amount: '147.09' }],
      monthly_costs: [{ currency: 'CNY', amount: '47.09' }],
      monthly_token_usage: '178767054',
      total_usage: '1367'
    }
  }
};

const amountBody = {
  code: 0,
  data: {
    biz_code: 0,
    biz_data: {
      total: [],
      days: [{
        date: '2026-08-02',
        data: [
          {
            model: 'deepseek-v4-flash',
            usage: [
              { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '10000000' },
              { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '2000000' },
              { type: 'RESPONSE_TOKEN', amount: '500000' },
              { type: 'REQUEST', amount: '120' }
            ]
          },
          {
            model: 'deepseek-v4-pro',
            usage: [
              { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '3000000' },
              { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '1000000' },
              { type: 'RESPONSE_TOKEN', amount: '250000' },
              { type: 'REQUEST', amount: '40' }
            ]
          }
        ]
      }]
    }
  }
};

const costBody = {
  code: 0,
  data: {
    biz_code: 0,
    biz_data: [{
      currency: 'CNY',
      total: [],
      days: [{
        date: '2026-08-02',
        data: [
          {
            model: 'deepseek-v4-flash',
            usage: [
              { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '0.028' },
              { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '0.280' },
              { type: 'RESPONSE_TOKEN', amount: '0.140' },
              { type: 'REQUEST', amount: '0' }
            ]
          },
          {
            model: 'deepseek-v4-pro',
            usage: [
              { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '0.145' },
              { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '1.740' },
              { type: 'RESPONSE_TOKEN', amount: '0.870' },
              { type: 'REQUEST', amount: '0' }
            ]
          }
        ]
      }]
    }]
  }
};

test('parses the actual DeepSeek amount/cost response schema by model and day', () => {
  const result = parseDeepSeekPlatformPayloads({
    summaryBody,
    amountBody,
    costBody,
    now: new Date('2026-08-02T12:00:00+08:00')
  });

  assert.equal(result.balance.value, 73.91);
  assert.equal(result.date, '2026-08-02');
  assert.equal(result.models.flash.tokens, 12_500_000);
  assert.equal(result.models.flash.requests, 120);
  assert.equal(result.models.flash.cost, 0.448);
  assert.equal(result.models.flash.cacheRate, 10000000 / 12000000 * 100);
  assert.equal(result.models.pro.tokens, 4_250_000);
  assert.equal(result.models.pro.cost, 2.755);
  assert.equal(result.todayTokens, 16_750_000);
  assert.equal(result.todayRequests, 160);
  assert.equal(result.todayCost, 3.203);
  assert.equal(result.cacheRate, 13_000_000 / 16_000_000 * 100);
  assert.equal(result.account.monthlyCost, 47.09);
  assert.equal(result.account.monthlyTokens, 178_767_054);
});

test('uses the latest API day when local and UTC dates are absent', () => {
  const shiftedAmount = structuredClone(amountBody);
  const shiftedCost = structuredClone(costBody);
  shiftedAmount.data.biz_data.days[0].date = '2026-08-01';
  shiftedCost.data.biz_data[0].days[0].date = '2026-08-01';
  const result = parseDeepSeekPlatformPayloads({
    summaryBody,
    amountBody: shiftedAmount,
    costBody: shiftedCost,
    now: new Date('2026-08-03T12:00:00+08:00')
  });
  assert.equal(result.date, '2026-08-01');
  assert.equal(result.models.flash.tokens, 12_500_000);
});

test('does not turn monthly totals into Flash or Pro daily values', () => {
  const emptyAmount = structuredClone(amountBody);
  const emptyCost = structuredClone(costBody);
  emptyAmount.data.biz_data.days = [];
  emptyCost.data.biz_data[0].days = [];
  const result = parseDeepSeekPlatformPayloads({ summaryBody, amountBody: emptyAmount, costBody: emptyCost });
  assert.equal(result.models.flash.tokens, null);
  assert.equal(result.models.pro.tokens, null);
  assert.equal(result.todayTokens, null);
  assert.equal(result.account.monthlyTokens, 178_767_054);
});
