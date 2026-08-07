import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEEPSEEK_DETAIL_MIN_HEIGHT,
  KINDLE_LAYOUT,
  deepSeekMonthlyMetrics,
  modelTokenBreakdown,
  resolveDisplaySources,
  selectCodexQuotas,
  sourceLayoutBoxes
} from '../web/kindle-renderer.js';

const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');
const combinations = [
  { codex: true, deepseek: false, volcengine: false },
  { codex: false, deepseek: true, volcengine: false },
  { codex: false, deepseek: false, volcengine: true },
  { codex: true, deepseek: true, volcengine: false },
  { codex: true, deepseek: false, volcengine: true },
  { codex: false, deepseek: true, volcengine: true },
  { codex: true, deepseek: true, volcengine: true }
];

test('all seven non-empty source combinations receive bounded Kindle layout boxes', () => {
  for (const display of combinations) {
    const expected = Object.values(display).filter(Boolean).length;
    const boxes = sourceLayoutBoxes(display);
    assert.equal(boxes.length, expected);
    assert.deepEqual(boxes.map(box => box.source), resolveDisplaySources(display));
    for (const box of boxes) {
      assert.equal(box.x, 28);
      assert.equal(box.width, 544);
      assert.ok(box.height >= 120, 'even the most compact source should retain readable vertical space');
      assert.ok(box.y >= KINDLE_LAYOUT.contentTop);
      assert.ok(box.y + box.height <= KINDLE_LAYOUT.contentBottom + 0.001);
    }
    assert.equal(boxes.at(-1).y + boxes.at(-1).height, KINDLE_LAYOUT.contentBottom);
  }
});

test('DeepSeek always receives enough height for two full-width readable model rows', () => {
  for (const display of combinations.filter(item => item.deepseek)) {
    const deepseek = sourceLayoutBoxes(display).find(box => box.source === 'deepseek');
    assert.ok(deepseek.height >= DEEPSEEK_DETAIL_MIN_HEIGHT);
  }
  assert.equal(sourceLayoutBoxes({ codex: true, deepseek: true, volcengine: true })[1].height, 318);
  assert.equal(sourceLayoutBoxes({ codex: true, deepseek: true, volcengine: false })[1].height, 390);
});

test('DeepSeek model rows retain total, cache miss, cache hit, output, and cache rate', () => {
  assert.deepEqual(modelTokenBreakdown({
    cacheMissTokens: 120,
    cacheHitTokens: 340,
    outputTokens: 56
  }), {
    cacheMissTokens: 120,
    cacheHitTokens: 340,
    outputTokens: 56
  });
  for (const label of ['V4 FLASH', 'V4 PRO', '未缓存', '已缓存', '输出', '缓存率']) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /'总 ' \+ formatTokens\(model\.tokens\) \+ ' TOKEN'/);
  assert.doesNotMatch(renderer, /box\.height < 245/);
});

test('Codex identifies weekly quota while leaving room for a future 5h quota', () => {
  const weekly = { id: 'weekly', remainingPercent: 63 };
  assert.deepEqual(selectCodexQuotas({ quotas: [weekly] }), { weekly, hourly: null });
});

test('DeepSeek money statistics retain cumulative and monthly values', () => {
  assert.deepEqual(deepSeekMonthlyMetrics({
    account: { cumulativeCost: 123.45, monthlyCost: 18.2, monthlyTokens: 9000, monthlyRequests: 22 }
  }), {
    cumulativeCost: 123.45,
    monthlyCost: 18.2,
    monthlyTokens: 9000,
    monthlyRequests: 22
  });
});
