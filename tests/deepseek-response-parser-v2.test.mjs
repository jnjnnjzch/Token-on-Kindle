import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepSeekResponses } from '../shared/deepseek-response-parser-v2.mjs';

const now = new Date('2026-08-02T09:30:00+08:00');

test('parses flat model/day records with cost and cache tokens', () => {
  const result = parseDeepSeekResponses([{
    path: '/usage/amount',
    body: {
      data: [
        {
          date: '2026-08-02',
          model_name: 'deepseek-v4-flash',
          total_tokens: 10_000_000,
          prompt_cache_hit_tokens: 8_000_000,
          prompt_cache_miss_tokens: 1_000_000,
          response_tokens: 1_000_000,
          cost: 1.91
        },
        {
          date: '2026-08-02',
          model_name: 'deepseek-v4-pro',
          total_tokens: 2_500_000,
          prompt_cache_hit_tokens: 1_000_000,
          prompt_cache_miss_tokens: 1_000_000,
          response_tokens: 500_000,
          cost: 1.51
        }
      ]
    }
  }], now);

  assert.equal(result.models.flash.tokens, 10_000_000);
  assert.equal(result.models.flash.cost, 1.91);
  assert.equal(result.models.flash.cacheRate, 8_000_000 / 9_000_000 * 100);
  assert.equal(result.models.pro.tokens, 2_500_000);
  assert.equal(result.todayTokens, 12_500_000);
  assert.equal(result.todayCost, 3.42);
});

test('parses cost chart series split by model', () => {
  const result = parseDeepSeekResponses([{
    path: '/usage/cost',
    body: {
      xAxis: { data: ['2026-08-01', '2026-08-02'] },
      series: [
        { name: 'deepseek-v4-flash', data: [1.2, 1.91] },
        { name: 'deepseek-v4-pro', data: [0.8, 1.51] }
      ]
    }
  }], now);

  assert.equal(result.models.flash.cost, 1.91);
  assert.equal(result.models.pro.cost, 1.51);
});

test('parses token chart whose model identity comes from request URL', () => {
  const result = parseDeepSeekResponses([
    {
      path: '/usage/amount?model=deepseek-v4-flash',
      body: {
        dates: ['2026-08-01', '2026-08-02'],
        series: [
          { name: 'PROMPT_CACHE_HIT_TOKEN', data: [7, 8_000_000] },
          { name: 'PROMPT_CACHE_MISS_TOKEN', data: [2, 1_000_000] },
          { name: 'RESPONSE_TOKEN', data: [1, 1_000_000] }
        ]
      }
    },
    {
      path: '/usage/amount?model=deepseek-v4-pro',
      body: {
        dates: ['2026-08-01', '2026-08-02'],
        series: [
          { name: 'PROMPT_CACHE_HIT_TOKEN', data: [5, 1_000_000] },
          { name: 'PROMPT_CACHE_MISS_TOKEN', data: [3, 1_000_000] },
          { name: 'RESPONSE_TOKEN', data: [2, 500_000] }
        ]
      }
    }
  ], now);

  assert.equal(result.models.flash.tokens, 10_000_000);
  assert.equal(result.models.pro.tokens, 2_500_000);
  assert.equal(result.cacheRate, 9_000_000 / 11_000_000 * 100);
});

test('parses nested metric name/value objects', () => {
  const result = parseDeepSeekResponses([{
    path: '/usage/by-model',
    body: {
      rows: [
        {
          model: 'deepseek-v4-flash',
          date: '2026-08-02',
          metrics: [
            { name: 'TOTAL_TOKEN', value: 1234 },
            { name: 'COST_CNY', value: 0.12 }
          ]
        },
        {
          model: 'deepseek-v4-pro',
          date: '2026-08-02',
          metrics: [
            { name: 'TOTAL_TOKEN', value: 456 },
            { name: 'COST_CNY', value: 0.34 }
          ]
        }
      ]
    }
  }], now);

  assert.equal(result.models.flash.tokens, 1234);
  assert.equal(result.models.flash.cost, 0.12);
  assert.equal(result.models.pro.tokens, 456);
  assert.equal(result.models.pro.cost, 0.34);
});

test('does not copy an unscoped range total into both models', () => {
  const result = parseDeepSeekResponses([{
    path: '/usage/summary',
    body: {
      total_tokens: 174_911_578,
      api_requests: 1351,
      range: '2026-07-01 to 2026-08-02'
    }
  }], now);

  assert.equal(result.models.flash.tokens, null);
  assert.equal(result.models.pro.tokens, null);
  assert.equal(result.todayTokens, null);
});

test('prefers the newest response for the same model/date/metric', () => {
  const result = parseDeepSeekResponses([
    {
      order: 1,
      path: '/usage/amount',
      body: [{ date: '2026-08-02', model: 'deepseek-v4-flash', total_tokens: 100 }]
    },
    {
      order: 2,
      path: '/usage/amount',
      body: [{ date: '2026-08-02', model: 'deepseek-v4-flash', total_tokens: 120 }]
    }
  ], now);

  assert.equal(result.models.flash.tokens, 120);
});
