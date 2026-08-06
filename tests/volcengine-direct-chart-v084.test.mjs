import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseVolcengineInternalApiPayloads } from '../shared/volcengine-internal-api-parser.mjs';
import { diagnosticSnapshot } from '../web/diagnostics.js';

test('internal API parser preserves AFP and per-model token categories', () => {
  const parsed = parseVolcengineInternalApiPayloads({
    afpBody: {
      Result: {
        SeatAFPUsages: [{
          PlanType: 'Small',
          AFPFiveHour: { Quota: 4000, Used: 0, ResetTime: 100 },
          AFPWeekly: { Quota: 14000, Used: 507.1632, ResetTime: 200 },
          AFPMonthly: { Quota: 40000, Used: 507.1632, ResetTime: 300 }
        }]
      }
    },
    modelListBody: {
      Result: {
        Data: [
          { RespModelID: 'deepseek-v4-flash' },
          { RespModelID: 'kimi-k2.6' }
        ]
      }
    },
    usageBody: {
      Result: {
        SeatUsageDetails: [{
          UsageDetails: [
            {
              ObjectName: 'deepseek-v4-flash',
              UsageResults: [
                { Name: 'InputTokens', MetricItems: [{ Values: [{ Timestamp: 10, Value: 100 }, { Timestamp: 20, Value: 120 }] }] },
                { Name: 'CacheHitTokens', MetricItems: [{ Values: [{ Timestamp: 10, Value: 20 }, { Timestamp: 20, Value: 30 }] }] },
                { Name: 'OutputTokens', MetricItems: [{ Values: [{ Timestamp: 10, Value: 40 }, { Timestamp: 20, Value: 50 }] }] },
                { Name: 'RequestCount', MetricItems: [{ Values: [{ Timestamp: 10, Value: 2 }, { Timestamp: 20, Value: 3 }] }] }
              ]
            },
            {
              ObjectName: 'kimi-k2.6',
              UsageResults: [
                { Name: 'TotalTokens', MetricItems: [{ Values: [{ Timestamp: 10, Value: 7 }, { Timestamp: 20, Value: 9 }] }] }
              ]
            }
          ]
        }]
      }
    },
    usageRequestBody: {
      Filter: { StartTime: '2026-08-01', EndTime: '2026-08-07' },
      QueryInterval: 'Day'
    }
  });

  assert.equal(parsed.windows.length, 3);
  assert.equal(parsed.windows[1].used, 507.1632);
  const deepseek = parsed.models.find(model => model.name === 'deepseek-v4-flash');
  assert.equal(deepseek.totalTokens, 360);
  assert.equal(deepseek.latestTokens, 200);
  assert.equal(deepseek.inputTokens, 220);
  assert.equal(deepseek.cachedTokens, 50);
  assert.equal(deepseek.outputTokens, 90);
  assert.equal(deepseek.requests, 5);
  assert.equal(parsed.modelUsage.source, 'console-internal-api');
});

test('positional usage rows are paired with the model-list response', () => {
  const parsed = parseVolcengineInternalApiPayloads({
    afpBody: {
      Result: {
        SeatAFPUsages: [{
          AFPFiveHour: { Quota: 1, Used: 0 },
          AFPWeekly: { Quota: 1, Used: 0 },
          AFPMonthly: { Quota: 1, Used: 0 }
        }]
      }
    },
    modelListBody: { Result: { Data: [{ RespModelID: 'model-a' }, { RespModelID: 'model-b' }] } },
    usageBody: {
      Result: {
        Data: [
          { Metrics: [{ Name: 'TotalTokens', Values: [{ Timestamp: 1, Value: 11 }] }] },
          { Metrics: [{ Name: 'TotalTokens', Values: [{ Timestamp: 1, Value: 22 }] }] }
        ]
      }
    }
  });
  assert.equal(parsed.models.find(model => model.name === 'model-a').latestTokens, 11);
  assert.equal(parsed.models.find(model => model.name === 'model-b').latestTokens, 22);
});

test('Volcengine production reader is a session API worker without DOM or ECharts fallback', async () => {
  const reader = await readFile(new URL('../web/volcengine-direct-reader.js', import.meta.url), 'utf8');
  const built = await readFile(new URL('../web/extractor.js', import.meta.url), 'utf8');
  for (const marker of [
    'GetAgentPlanSeatAFPUsage',
    'ListAgentPlanUsageDetailObjects',
    'GetAgentPlanSeatUsageDetails',
    'console-internal-api',
    'v0.6.2-reload-worker',
    '/robots.txt#token-on-kindle-api-worker'
  ]) {
    assert.match(reader, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(built, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(reader, /sessionStorage\.setItem\(TEMPLATE_KEY/);
  assert.match(reader, /credentials:\s*'include'/);
  assert.match(reader, /location\.reload\(\)/);
  assert.match(reader, /location\.replace\(WORKER_URL\)/);
  assert.doesNotMatch(reader, /模型调用明细|_echarts_instance_|getEchartsInstance|collectWindow|usageCard/);
  assert.doesNotMatch(built, /__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__/);
  assert.doesNotMatch(built, /__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__/);
  assert.doesNotMatch(built, /__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__/);
});

test('diagnostic JSON keeps internal API model fields', () => {
  const snapshot = diagnosticSnapshot('volcengine', {
    source: 'volcengine',
    capturedAt: '2026-08-07T00:00:00Z',
    plan: 'Agent Plan 企业版 · Small',
    unit: 'AFP',
    windows: [],
    models: [{
      name: 'kimi-k2.6',
      totalTokens: 1234,
      latestTokens: 321,
      inputTokens: 600,
      cachedTokens: 300,
      outputTokens: 334,
      pointCount: 7
    }],
    modelUsage: {
      source: 'console-internal-api',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-07',
      granularity: 'Day'
    },
    diagnostics: {
      primarySource: 'console-internal-api',
      lifecycle: 'v0.6.2-reload-worker',
      modelCount: 1
    }
  });
  assert.equal(snapshot.models[0].name, 'kimi-k2.6');
  assert.equal(snapshot.models[0].latestTokens, 321);
  assert.equal(snapshot.modelUsage.source, 'console-internal-api');
  assert.equal(snapshot.diagnostics.lifecycle, 'v0.6.2-reload-worker');
});
