import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyVolcengineDebugPayload,
  compareVolcengineDebugResults,
  isSafeVolcengineReplayCandidate,
  sanitizeVolcengineUrl,
  summarizeVolcengineRequestBody
} from '../shared/volcengine-debug-core.mjs';

test('classifies enterprise AFP payloads by structure', () => {
  const result = classifyVolcengineDebugPayload({
    Result: {
      SeatID: 'seat-1',
      PlanType: 'enterprise',
      AFPFiveHour: { Quota: 4000, Used: 120, ResetTime: 123 },
      AFPWeekly: { Quota: 14000, Used: 500, ResetTime: 456 },
      AFPMonthly: { Quota: 50000, Used: 800, ResetTime: 789 }
    }
  });
  assert.equal(result.relevant, true);
  assert.ok(result.kinds.includes('afp'));
  assert.ok(result.kinds.includes('seat'));
});

test('classifies model token payloads by structure', () => {
  const result = classifyVolcengineDebugPayload({
    data: [{ modelName: 'doubao', inputTokens: 100, outputTokens: 20, cachedTokens: 30, requestCount: 2 }]
  });
  assert.equal(result.relevant, true);
  assert.ok(result.kinds.includes('models'));
});

test('sanitizes secrets from URLs and request bodies', () => {
  const url = sanitizeVolcengineUrl('https://console.volcengine.com/path?action=GetUsage&token=secret&start=2026-08-01');
  assert.match(url, /action=GetUsage/);
  assert.match(url, /start=2026-08-01/);
  assert.doesNotMatch(url, /secret/);

  const body = summarizeVolcengineRequestBody(JSON.stringify({ Action: 'GetSeatUsageDetails', Authorization: 'secret', SeatID: 'seat-1' }));
  assert.equal(body.hints.Authorization, undefined);
  assert.equal(body.hints.Action, 'GetSeatUsageDetails');
  assert.equal(body.hints.SeatID, '[identifier]');
});

test('only replays read-only request shapes', () => {
  assert.equal(isSafeVolcengineReplayCandidate({ method: 'GET', url: 'https://example.test/usage' }), true);
  assert.equal(isSafeVolcengineReplayCandidate({ method: 'POST', url: '/api', body: JSON.stringify({ Action: 'GetSeatUsageDetails' }) }), true);
  assert.equal(isSafeVolcengineReplayCandidate({ method: 'POST', url: '/api', body: JSON.stringify({ Action: 'UpdateSeat' }) }), false);
});

test('compares method availability', () => {
  const result = compareVolcengineDebugResults({ dom: { windows: [{}, {}, {}] }, echarts: { models: [{}] }, network: { relevantCount: 2 } });
  assert.deepEqual(result.successful.sort(), ['dom', 'echarts', 'network']);
});

test('keeps usage token counters while redacting auth tokens', () => {
  const result = classifyVolcengineDebugPayload({ inputTokens: 42, outputTokens: 8, accessToken: 'secret-value' });
  assert.equal(result.relevantValues['$.inputTokens'], 42);
  assert.equal(result.relevantValues['$.outputTokens'], 8);
  assert.equal(result.relevantValues['$.accessToken'], undefined);
});
