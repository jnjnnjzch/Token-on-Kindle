import test from 'node:test';
import assert from 'node:assert/strict';
import { KINDLE_LAYOUT, renderKindleDashboard, selectCodexQuotas } from '../web/kindle-renderer.js';

function recordingContext() {
  const texts = [];
  const fills = [];
  const noOp = () => {};
  const context = new Proxy({
    save: noOp,
    restore: noOp,
    setTransform: noOp,
    clearRect: noOp,
    strokeRect: noOp,
    beginPath: noOp,
    moveTo: noOp,
    lineTo: noOp,
    stroke: noOp,
    fillRect(x, y, width, height) { fills.push({ x, y, width, height }); },
    fillText(value, x, y) { texts.push({ value: String(value), x, y }); }
  }, {
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
  return { context, texts, fills };
}

function render(state) {
  const recording = recordingContext();
  renderKindleDashboard(recording.context, state);
  return recording;
}

test('sync freshness moves from the old footer into the compact top header', () => {
  const { texts } = render({
    codex: { quotas: [{ id: 'weekly', remainingPercent: 65 }], capturedAt: '2026-08-07T04:25:00.000Z' },
    deepseek: { capturedAt: '2026-08-07T04:26:00.000Z' },
    volcengine: { capturedAt: '2026-08-07T04:27:00.000Z' },
    displaySources: { codex: true, deepseek: true, volcengine: true }
  });
  const sync = texts.find(item => item.value.startsWith('C ') && item.value.includes('D ') && item.value.includes('V '));
  assert.ok(sync, 'C/D/V sync times should be rendered as one compact status line');
  assert.ok(sync.y < KINDLE_LAYOUT.contentTop, 'sync status should live in the top header');
});

test('Codex reserves a quiet 5h row even before OpenAI exposes the quota', () => {
  const { texts } = render({
    codex: { quotas: [{ id: 'weekly', remainingPercent: 65, usedPercent: 35 }] },
    displaySources: { codex: true, deepseek: false, volcengine: false }
  });
  assert.ok(texts.some(item => item.value === '5 小时额度'));
  assert.ok(texts.some(item => item.value === '周额度'));
  assert.ok(texts.some(item => item.value === '—'));
  assert.ok(!texts.some(item => /登录后自动识别|打开 Codex Analytics/.test(item.value)));
});

test('Codex automatically renders a real 5h quota when one appears', () => {
  const hourly = { id: '5h', remainingPercent: 82, usedPercent: 18, resetText: '2小时后' };
  const weekly = { id: 'weekly', remainingPercent: 65, usedPercent: 35 };
  assert.deepEqual(selectCodexQuotas({ quotas: [weekly, hourly] }), { weekly, hourly });
  const { texts } = render({
    codex: { quotas: [weekly, hourly] },
    displaySources: { codex: true, deepseek: false, volcengine: false }
  });
  assert.ok(texts.some(item => item.value === '82%'));
  assert.ok(texts.some(item => item.value === '已用 18%'));
  assert.ok(texts.some(item => item.value === '2小时后'));
});

test('the Kindle unlock shelf remains the bottom 84px gray system area', () => {
  const { fills } = render({
    codex: { quotas: [{ id: 'weekly', remainingPercent: 65 }] },
    displaySources: { codex: true, deepseek: false, volcengine: false }
  });
  assert.equal(KINDLE_LAYOUT.width, 600);
  assert.equal(KINDLE_LAYOUT.height, 800);
  assert.equal(KINDLE_LAYOUT.unlockTop, 716);
  assert.equal(KINDLE_LAYOUT.unlockHeight, 84);
  assert.ok(fills.some(fill => fill.x === 0 && fill.y === 716 && fill.width === 600 && fill.height === 84));
});
