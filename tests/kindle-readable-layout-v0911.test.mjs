import test from 'node:test';
import assert from 'node:assert/strict';
import { KINDLE_LAYOUT, renderKindleDashboard, selectCodexQuotas } from '../web/kindle-renderer.js';

function recordingContext() {
  const texts = [];
  const fills = [];
  const strokes = [];
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
    fillText(value, x, y) { texts.push({ value: String(value), x, y }); }
  }, {
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
  return { context, texts, fills, strokes };
}

function render(state) {
  const recording = recordingContext();
  renderKindleDashboard(recording.context, state);
  return recording;
}

test('sync freshness is integrated into the compact top header with readable source names', () => {
  const { texts } = render({
    codex: { quotas: [{ id: 'weekly', remainingPercent: 65 }], capturedAt: '2026-08-07T04:25:00.000Z' },
    deepseek: { capturedAt: '2026-08-07T04:26:00.000Z' },
    volcengine: { capturedAt: '2026-08-07T04:27:00.000Z' },
    displaySources: { codex: true, deepseek: true, volcengine: true }
  });
  const sync = texts.find(item => item.value.includes('Codex ') && item.value.includes('DeepSeek ') && item.value.includes('火山方舟 '));
  assert.ok(sync, 'friendly source names and sync times should share one compact header line');
  assert.ok(sync.y < KINDLE_LAYOUT.contentTop, 'sync status should live in the top header');
  assert.ok(!/^C\s/.test(sync.value), 'cryptic C/D/V prefixes should not return');
});

test('Codex does not render a 5h row when OpenAI did not return one', () => {
  const { texts } = render({
    codex: { quotas: [{ id: 'weekly', remainingPercent: 65, usedPercent: 35 }] },
    displaySources: { codex: true, deepseek: false, volcengine: false }
  });
  assert.ok(!texts.some(item => item.value === '5 小时额度'));
  assert.ok(texts.some(item => item.value === '周额度'));
  assert.ok(texts.some(item => item.value === '65%'));
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
  assert.ok(texts.some(item => item.value === '5 小时额度'));
  assert.ok(texts.some(item => item.value === '82%'));
  assert.ok(texts.some(item => item.value === '已用 18%'));
  assert.ok(texts.some(item => item.value === '2小时后'));
});

test('top-level source frames stay removed while two light DeepSeek subcards preserve hierarchy', () => {
  const sourceBox = { x: 28, y: KINDLE_LAYOUT.contentTop, width: 544, height: KINDLE_LAYOUT.contentBottom - KINDLE_LAYOUT.contentTop };
  const codex = render({
    codex: { quotas: [{ id: 'weekly', remainingPercent: 65, usedPercent: 35 }] },
    displaySources: { codex: true, deepseek: false, volcengine: false }
  });
  assert.ok(!codex.strokes.some(item => item.x === sourceBox.x && item.y === sourceBox.y && item.width === sourceBox.width && item.height === sourceBox.height));

  const deepseek = render({
    deepseek: {
      balance: 10,
      models: {
        flash: { tokens: 1000, cacheHitTokens: 700, cacheMissTokens: 200, outputTokens: 100, cacheRate: 77 },
        pro: { tokens: 800, cacheHitTokens: 500, cacheMissTokens: 200, outputTokens: 100, cacheRate: 71 }
      }
    },
    displaySources: { codex: false, deepseek: true, volcengine: false }
  });
  assert.ok(!deepseek.strokes.some(item => item.x === sourceBox.x && item.y === sourceBox.y && item.width === sourceBox.width && item.height === sourceBox.height));
  const modelFrames = deepseek.strokes.filter(item => item.width > 240 && item.width < 300 && item.height >= 160 && item.height <= 220);
  assert.equal(modelFrames.length, 2, 'only Flash and Pro should use subordinate card frames');
  assert.ok(Math.abs(modelFrames[0].y - modelFrames[1].y) < 2, 'model subcards should align horizontally');
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
