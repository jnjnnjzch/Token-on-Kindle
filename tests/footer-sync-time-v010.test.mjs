import test from 'node:test';
import assert from 'node:assert/strict';
import { renderKindleDashboard } from '../web/kindle-renderer.js';

function recordingContext() {
  const texts = [];
  const noOp = () => {};
  const context = new Proxy({
    save: noOp,
    restore: noOp,
    setTransform: noOp,
    clearRect: noOp,
    fillRect: noOp,
    strokeRect: noOp,
    beginPath: noOp,
    moveTo: noOp,
    lineTo: noOp,
    stroke: noOp,
    fillText(value) { texts.push(String(value)); }
  }, {
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
  return { context, texts };
}

function footerFor(source) {
  const { context, texts } = recordingContext();
  renderKindleDashboard(context, {
    codex: {
      quotas: [{ id: 'weekly', remainingPercent: 80, usedPercent: 20 }],
      ...source
    },
    displaySources: { codex: true, deepseek: false, volcengine: false }
  });
  return texts.find(value => value.startsWith('C '));
}

test('Kindle footer shows the successful capture time after refresh', () => {
  const footer = footerFor({
    capturedAt: '2026-08-07T03:40:00.000Z',
    syncRequestedAt: '1786074000'
  });
  assert.ok(footer, 'Codex footer timestamp should be rendered');
  assert.notEqual(footer, 'C 未同步');
});

test('Kindle footer accepts Unix-second sync timestamps as a fallback', () => {
  const footer = footerFor({ syncRequestedAt: '1786074000' });
  assert.ok(footer, 'Codex footer timestamp should be rendered');
  assert.notEqual(footer, 'C 未同步');
});
