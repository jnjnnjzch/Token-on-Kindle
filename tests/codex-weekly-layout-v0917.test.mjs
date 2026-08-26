import test from 'node:test';
import assert from 'node:assert/strict';
import { renderKindleDashboard } from '../web/kindle-renderer.js';

function fakeContext() {
  const operations = [];
  return {
    operations,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textBaseline: '',
    textAlign: '',
    fillText(text, x, y) { operations.push({ type: 'text', text: String(text), x, y }); },
    fillRect(x, y, width, height) { operations.push({ type: 'fillRect', x, y, width, height }); },
    strokeRect(x, y, width, height) { operations.push({ type: 'strokeRect', x, y, width, height }); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {}
  };
}

function dualState() {
  return {
    displaySources: { codex: true, deepseek: true, volcengine: false },
    codex: {
      capturedAt: '2026-08-26T12:00:00Z',
      quotas: [
        { id: '5h', remainingPercent: 77, usedPercent: 23, resetText: '2h 14m' },
        { id: 'weekly', remainingPercent: 61, usedPercent: 39, resetText: 'Aug 30, 4:00 PM' }
      ]
    },
    deepseek: {
      capturedAt: '2026-08-26T12:00:00Z',
      balance: 12.34,
      todayCost: 1.23,
      todayTokens: 123456,
      cacheRate: 72,
      account: { cumulativeCost: 50, monthlyCost: 10, monthlyTokens: 1000000 },
      models: {
        flash: { tokens: 70000, cost: 0.7, cacheMissTokens: 10000, cacheHitTokens: 50000, outputTokens: 10000, cacheRate: 83.3 },
        pro: { tokens: 53456, cost: 0.53, cacheMissTokens: 20000, cacheHitTokens: 23456, outputTokens: 10000, cacheRate: 54 }
      }
    }
  };
}

test('Codex renders 5-hour quota on the left and weekly quota on the right', () => {
  const ctx = fakeContext();
  renderKindleDashboard(ctx, dualState());
  const hourly = ctx.operations.find(item => item.type === 'text' && item.text === '5 小时额度');
  const weekly = ctx.operations.find(item => item.type === 'text' && item.text === '周额度');
  assert.ok(hourly);
  assert.ok(weekly);
  assert.ok(hourly.x < weekly.x, `expected 5h x ${hourly.x} < weekly x ${weekly.x}`);

  const hourlyReset = ctx.operations.find(item => item.type === 'text' && item.text.includes('2h 14m'));
  const weeklyReset = ctx.operations.find(item => item.type === 'text' && item.text.includes('Aug 30'));
  assert.ok(hourlyReset);
  assert.ok(weeklyReset);
  assert.notEqual(hourlyReset.text, weeklyReset.text, 'weekly reset must never reuse the rendered 5h reset text');
  assert.ok(hourlyReset.x < weeklyReset.x);
});

test('Codex + DeepSeek only uses the v0.6.2 portrait geometry', () => {
  const ctx = fakeContext();
  renderKindleDashboard(ctx, dualState());
  const find = text => ctx.operations.find(item => item.type === 'text' && item.text === text);
  assert.equal(find('CODEX')?.y, 82);
  assert.equal(find('DEEPSEEK')?.y, 246);
  assert.equal(find('V4 FLASH')?.y, 406);
  assert.equal(find('V4 PRO')?.y, 406);
  assert.equal(find('总体缓存命中率')?.y, 598);
});

test('Volcengine stays on the independent current renderer while Codex still keeps 5h left and weekly right', () => {
  const ctx = fakeContext();
  const state = dualState();
  state.displaySources.volcengine = true;
  state.volcengine = {
    capturedAt: '2026-08-26T12:00:00Z',
    windows: [
      { id: '5h', label: '近5小时用量', used: 10, total: 4000, usedPercent: 0.25 },
      { id: 'weekly', label: '近一周用量', used: 500, total: 14000, usedPercent: 3.57 },
      { id: 'monthly', label: '近一月用量', used: 1000, total: 50000, usedPercent: 2 }
    ]
  };
  renderKindleDashboard(ctx, state);
  assert.ok(ctx.operations.some(item => item.type === 'text' && item.text === '火山方舟 AFP'));
  const deepseekHeading = ctx.operations.find(item => item.type === 'text' && item.text === 'DEEPSEEK');
  assert.notEqual(deepseekHeading?.y, 246, 'three-source mode must not use the v0.6.2 dual-source geometry');

  const hourly = ctx.operations.find(item => item.type === 'text' && item.text === '5 小时额度');
  const weekly = ctx.operations.find(item => item.type === 'text' && item.text === '周额度');
  assert.ok(hourly);
  assert.ok(weekly);
  assert.ok(hourly.x < weekly.x, 'three-source Codex layout must also keep 5h on the left');
});
