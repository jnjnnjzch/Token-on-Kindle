import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeVolcengineModels, sourceLayoutBoxes, volcengineModelLayoutPlan } from '../web/kindle-renderer.js';

test('today-only Volcengine display excludes monthly-only and zero-latest models', () => {
  const models = normalizeVolcengineModels({ models: [
    { name: 'monthly-only', totalTokens: 5000 },
    { name: 'zero-today', totalTokens: 4000, latestTokens: 0 },
    { name: 'active-small', totalTokens: 1000, latestTokens: 12 },
    { name: 'active-large', totalTokens: 900, latestTokens: 120 }
  ] });
  assert.deepEqual(models.map(model => model.name), ['active-large', 'active-small']);
  assert.deepEqual(models.map(model => model.latestTokens), [120, 12]);
});

test('three-source portrait layout preserves Volcengine room and readable type', () => {
  const boxes = sourceLayoutBoxes({ codex: true, deepseek: true, volcengine: true });
  assert.deepEqual(boxes.map(box => box.height), [146, 332, 150]);
  assert.equal(boxes.at(-1).y + boxes.at(-1).height, 706);
  const plan = volcengineModelLayoutPlan(150, 8);
  assert.equal(plan.columns, 2);
  assert.equal(plan.rows, 4);
  assert.ok(plan.fontSize >= 8.5);
  assert.ok(plan.modelAreaHeight >= 50);
});

test('generated renderer labels and displays latest token values', async () => {
  const renderer = await readFile(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');
  const start = renderer.indexOf('/* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST */');
  const end = renderer.indexOf('\nfunction drawVolcengine(ctx', start);
  const block = renderer.slice(start, end);
  assert.match(block, /今日模型 TOKEN/);
  assert.match(block, /今日调用/);
  assert.match(block, /formatTokens\(model\.latestTokens\)/);
  assert.doesNotMatch(block, /formatTokens\(model\.totalTokens\)/);
});
