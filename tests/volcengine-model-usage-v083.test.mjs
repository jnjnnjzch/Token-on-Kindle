import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVolcengineModelUsageResponses } from '../shared/volcengine-response-parser.mjs';
import { normalizeVolcengineModels, sourceLayoutBoxes, volcengineModelLayoutPlan } from '../web/kindle-renderer.js';

const base = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const compiled = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');

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

test('model text layout keeps every model at every card height', () => {
  const single = volcengineModelLayoutPlan(584, 1);
  const compact = volcengineModelLayoutPlan(170, 8);
  const medium = volcengineModelLayoutPlan(226, 4);
  const tall = volcengineModelLayoutPlan(584, 8);
  assert.equal(single.columns, 1);
  assert.equal(compact.columns, 2);
  assert.equal(medium.columns, 2);
  assert.equal(tall.columns, 3);
  for (const [plan, count, height] of [[compact, 8, 170], [medium, 4, 226], [tall, 8, 584]]) {
    assert.equal(plan.visibleCount, count);
    assert.equal(plan.capacity, count);
    assert.equal(plan.overflowCount, 0);
    assert.ok(plan.rows * plan.columns >= count);
    assert.ok(plan.fontSize >= 7);
    assert.ok(plan.quotaHeight + plan.modelAreaHeight + plan.sectionGap + 47 <= height + 2);
  }
});

test('three-source compact Volcengine card shows six models as two columns by three rows', () => {
  const boxes = sourceLayoutBoxes({ codex: true, deepseek: true, volcengine: true });
  assert.deepEqual(boxes.map(box => box.height), [132, 294, 150]);
  const compact = volcengineModelLayoutPlan(150, 6);
  assert.equal(compact.columns, 2);
  assert.equal(compact.rows, 3);
  assert.equal(compact.visibleCount, 6);
  assert.equal(compact.overflowCount, 0);
  assert.equal(boxes.at(-1).y + boxes.at(-1).height, 666);
  assert.match(renderer, /TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST/);
  assert.match(renderer, /今日模型 TOKEN/);
  assert.match(renderer, /今日调用/);
  assert.match(renderer, /formatTokens\(model\.latestTokens\)/);
  assert.doesNotMatch(renderer, /其余 \$\{entry\.count\} 个模型/);
  assert.doesNotMatch(renderer, /drawVolcengineModelCell\(ctx, entry\.model/);
});

test('renderer keeps only models with latest token usage and sorts by today tokens', () => {
  const models = normalizeVolcengineModels({ models: [
    { name: '本月有量但今日无调用', totalTokens: 9000, latestTokens: 0 },
    { name: '今日模型 B', totalTokens: 100, latestTokens: 15 },
    { name: '今日模型 A', totalTokens: 50, latestTokens: 80 },
    { name: '缺少今日点', totalTokens: 700 }
  ] });
  assert.deepEqual(models.map(model => model.name), ['今日模型 A', '今日模型 B']);
  assert.deepEqual(models.map(model => model.latestTokens), [80, 15]);
  assert.equal(models[0].totalTokens, 50);
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
