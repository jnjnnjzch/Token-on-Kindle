import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deepSeekMonthlyMetrics,
  resolveDisplaySources,
  selectCodexQuotas,
  sourceLayoutBoxes
} from '../web/kindle-renderer.js';

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
      assert.ok(box.height > 170);
      assert.ok(box.y >= 82);
      assert.ok(box.y + box.height <= 666.001);
    }
  }
});

test('Codex keeps a full-width single quota when no 5h limit exists', () => {
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
