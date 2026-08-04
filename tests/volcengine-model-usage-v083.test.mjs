import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVolcengineModelUsageResponses } from '../shared/volcengine-response-parser.mjs';
import { normalizeVolcengineModels, sourceLayoutBoxes, volcengineModelLayoutPlan } from '../web/kindle-renderer.js';

const base = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const compiled = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

const response = (order, body, path = '/api?Action=GetSeatUsageDetails') => ({ order, body, path, capturedAt: `2026-08-04T0${order}:00:00Z` });

test('legacy Volcengine response parser remains compatible with exported API fixtures', () => {
  const parsed = parseVolcengineModelUsageResponses([
    response(1, {
      Result: {
        UsageDetails: [
          { ModelName: 'doubao-seed-1-6', TotalTokens: 1200, InputTokens: 800, OutputTokens: 400, RequestCount: 3 },
          { model_name: 'deepseek-v3.2', prompt_tokens: 2000, completion_tokens: 600, cache_hit_tokens: 500, calls: 7 },
          { FoundationModelName: 'kimi-k2', TokenCount: '3,200', AFPUsage: 12.5 }
        ]
      }
    })
  ]);
  assert.equal(parsed.models.length, 3);
  assert.deepEqual(parsed.models.map(model => model.name), ['kimi-k2', 'deepseek-v3.2', 'doubao-seed-1-6']);
  const deepseek = parsed.models.find(model => model.name === 'deepseek-v3.2');
  assert.equal(deepseek.totalTokens, 2600);
  assert.equal(deepseek.cachedTokens, 500);
  assert.equal(deepseek.requests, 7);
});

test('legacy response parser still selects the newest payload instead of summing refreshes', () => {
  const parsed = parseVolcengineModelUsageResponses([
    response(1, { rows: [{ modelName: 'doubao-seed', totalTokens: 100 }] }),
    response(2, { rows: [{ modelName: 'doubao-seed', totalTokens: 135 }] })
  ]);
  assert.equal(parsed.models.length, 1);
  assert.equal(parsed.models[0].totalTokens, 135);
  assert.equal(parsed.diagnostics.selectedOrder, 2);
});

test('model layout changes columns and capacity with count and card height', () => {
  const single = volcengineModelLayoutPlan(584, 1);
  const compact = volcengineModelLayoutPlan(170, 8);
  const medium = volcengineModelLayoutPlan(226, 4);
  const tall = volcengineModelLayoutPlan(584, 8);
  assert.equal(single.columns, 1);
  assert.equal(compact.columns, 2);
  assert.ok(compact.overflowCount > 0);
  assert.equal(medium.columns, 2);
  assert.equal(tall.columns, 3);
  assert.equal(tall.overflowCount, 0);
  for (const plan of [compact, medium, tall]) {
    assert.ok(plan.quotaHeight + plan.modelAreaHeight + plan.sectionGap + 47 <= (plan === compact ? 170 : plan === medium ? 226 : 584) + 2);
  }
});

test('three-source compact Volcengine card adapts without shrinking DeepSeek', () => {
  const boxes = sourceLayoutBoxes({ codex: true, deepseek: true, volcengine: true });
  assert.deepEqual(boxes.map(box => box.height), [132, 294, 138]);
  const compact = volcengineModelLayoutPlan(138, 8);
  assert.equal(compact.columns, 2);
  assert.ok(compact.overflowCount > 0);
  assert.equal(boxes.at(-1).y + boxes.at(-1).height, 666);
});

test('renderer normalizes and sorts arbitrary Volcengine model counts', () => {
  const models = normalizeVolcengineModels({ models: [
    { name: 'B', inputTokens: 10, outputTokens: 15 },
    { name: 'A', totalTokens: 100 },
    { name: 'C', totalTokens: 50 }
  ] });
  assert.deepEqual(models.map(model => model.name), ['A', 'C', 'B']);
  assert.equal(models[2].totalTokens, 25);
});

test('packaged extractor disables legacy Volcengine interception before reading ReactECharts', () => {
  for (const marker of ['模型调用明细', '__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__', '__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__', 'react-component']) {
    assert.match(compiled, new RegExp(marker));
  }
  const guard = compiled.indexOf('__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__ = true');
  assert.ok(guard >= 0);
  assert.doesNotMatch(compiled, /\n\s*installVolcengineNetworkCapture\(\);/);
  assert.match(compiled, /source = host === 'chatgpt\.com'.*volcengine/s);
  assert.doesNotMatch(compiled, /setInterval\(\(\) => location\.reload\(\), UPDATE_MS\)/);
  assert.doesNotMatch(base, /TOKEN-ON-KINDLE v0\.8\.4 DIRECT CHART BUILD/);
});
