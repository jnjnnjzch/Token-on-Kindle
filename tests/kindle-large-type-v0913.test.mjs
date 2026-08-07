import test from 'node:test';
import assert from 'node:assert/strict';
import { renderKindleDashboard } from '../web/kindle-renderer.js';

function recordingContext() {
  const texts = [];
  const strokes = [];
  const fills = [];
  let currentFont = '';
  const noOp = () => {};
  const context = new Proxy({
    save: noOp,
    restore: noOp,
    setTransform: noOp,
    clearRect: noOp,
    beginPath: noOp,
    moveTo: noOp,
    lineTo: noOp,
    stroke: noOp,
    strokeRect(x, y, width, height) { strokes.push({ x, y, width, height }); },
    fillRect(x, y, width, height) { fills.push({ x, y, width, height }); },
    fillText(value, x, y) {
      const match = currentFont.match(/([0-9.]+)px/);
      texts.push({ value: String(value), x, y, fontSize: match ? Number(match[1]) : 0, font: currentFont });
    }
  }, {
    set(target, property, value) {
      target[property] = value;
      if (property === 'font') currentFont = String(value);
      return true;
    }
  });
  return { context, texts, strokes, fills };
}

function sampleState() {
  return {
    codex: {
      capturedAt: '2026-08-07T08:10:00.000Z',
      quotas: [{ id: 'weekly', remainingPercent: 65, usedPercent: 35, resetText: '3天后重置' }]
    },
    deepseek: {
      capturedAt: '2026-08-07T08:11:00.000Z',
      balance: 100,
      todayCost: 3.25,
      todayTokens: 1234567,
      account: { cumulativeCost: 88.8, monthlyCost: 23.4, monthlyTokens: 8765432 },
      models: {
        flash: { tokens: 1200000, cost: 2.1, cacheMissTokens: 200000, cacheHitTokens: 900000, outputTokens: 100000, cacheRate: 81.8 },
        pro: { tokens: 340000, cost: 1.15, cacheMissTokens: 90000, cacheHitTokens: 200000, outputTokens: 50000, cacheRate: 69.0 }
      }
    },
    volcengine: {
      capturedAt: '2026-08-07T08:12:00.000Z',
      windows: [
        { id: '5h', label: '近5小时用量', used: 500, total: 4000, usedPercent: 12.5, resetText: '2小时后重置' },
        { id: 'weekly', label: '近一周用量', used: 2000, total: 14000, usedPercent: 14.3, resetText: '5天后重置' },
        { id: 'monthly', label: '近一月用量', used: 6000, total: 50000, usedPercent: 12, resetText: '20天后重置' }
      ],
      models: [
        { id: 'a', name: 'doubao-a', latestTokens: 900000, totalTokens: 900000 },
        { id: 'b', name: 'doubao-b', latestTokens: 800000, totalTokens: 800000 },
        { id: 'c', name: 'doubao-c', latestTokens: 700000, totalTokens: 700000 },
        { id: 'd', name: 'doubao-d', latestTokens: 600000, totalTokens: 600000 },
        { id: 'e', name: 'doubao-e', latestTokens: 500000, totalTokens: 500000 }
      ]
    },
    displaySources: { codex: true, deepseek: true, volcengine: true }
  };
}

function findText(texts, value) {
  return texts.find(item => item.value === value);
}

test('three-source Kindle layout keeps e-ink text readable without flattening hierarchy', () => {
  const recording = recordingContext();
  renderKindleDashboard(recording.context, sampleState());
  const { texts } = recording;

  for (const heading of ['CODEX', 'DEEPSEEK', '火山方舟 AFP']) {
    const item = findText(texts, heading);
    assert.ok(item, `${heading} should be rendered`);
    assert.ok(item.fontSize >= 18, `${heading} should use at least 18px bold type`);
  }

  const codexRemaining = findText(texts, '65%');
  assert.ok(codexRemaining && codexRemaining.fontSize >= 30, 'single Codex quota should use a large primary percentage');
  assert.ok(!texts.some(item => item.value === '5 小时额度'), 'missing 5h quota should consume no visual row');

  for (const label of ['余额', '今日费用', '今日 Token', '累计费用', '本月费用', '本月 Token']) {
    const item = findText(texts, label);
    assert.ok(item && item.fontSize >= 11, `${label} should stay readable`);
  }

  for (const label of ['未缓存', '已缓存', '输出', '缓存率']) {
    const items = texts.filter(item => item.value === label);
    assert.equal(items.length, 2, `${label} should appear in both model cards`);
    items.forEach(item => assert.ok(item.fontSize >= 12, `${label} should use readable e-ink type`));
  }
  for (const detail of ['200.0K', '900.0K', '100.0K']) {
    const item = findText(texts, detail);
    assert.ok(item && item.fontSize >= 14, `${detail} should remain visible in larger type`);
  }
  const flashRate = findText(texts, '81.8%');
  assert.ok(flashRate && flashRate.fontSize >= 14, 'cache percentage should not collapse to micro text');

  const flash = findText(texts, 'V4 FLASH');
  const pro = findText(texts, 'V4 PRO');
  assert.ok(flash && pro);
  assert.ok(Math.abs(flash.y - pro.y) < 2, 'Flash and Pro should share one horizontal row under DeepSeek');
  assert.ok(pro.x - flash.x > 200, 'Flash and Pro should be visually distinct side-by-side subcards');

  const flashTotal = findText(texts, '1.20M');
  const proTotal = findText(texts, '340.0K');
  assert.ok(flashTotal && proTotal);
  assert.ok(flashTotal.fontSize >= 24 && proTotal.fontSize >= 24, 'model totals should remain prominent');
  assert.ok(Math.abs(flashTotal.y - proTotal.y) < 2, 'model totals should align consistently');

  for (const name of ['doubao-a', 'doubao-b', 'doubao-c', 'doubao-d', 'doubao-e']) {
    const item = findText(texts, name);
    assert.ok(item, `${name} should not be omitted`);
    assert.ok(item.fontSize >= 12.5, `${name} should use Kindle-readable type`);
  }
});

test('Volcengine quota reset information and model token list remain present', () => {
  const recording = recordingContext();
  renderKindleDashboard(recording.context, sampleState());
  const values = recording.texts.map(item => item.value);

  assert.ok(values.includes('2小时后重置'));
  assert.ok(values.includes('5天后重置'));
  assert.ok(values.includes('20天后重置'));
  assert.ok(values.includes('今日模型 TOKEN'));
  assert.ok(values.includes('今日调用 5 个'));
  for (const tokenValue of ['900.0K', '800.0K', '700.0K', '600.0K', '500.0K']) {
    assert.ok(values.includes(tokenValue), `${tokenValue} should remain visible`);
  }
});
