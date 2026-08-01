import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCodexFromText, extractDeepSeekFromText, encodeGrayscalePng, verifyKindlePng, rgbaToGrayscale } from '../shared/core.mjs';

test('extracts weekly Codex remaining quota', () => {
  const result = extractCodexFromText(`Usage limits\nWeekly limit\n61% remaining\nResets Wednesday 09:18`);
  assert.equal(result.quotas[0].id, 'weekly');
  assert.equal(result.quotas[0].remainingPercent, 61);
  assert.equal(result.quotas[0].usedPercent, 39);
});

test('does not invent a removed 5-hour bucket', () => {
  const result = extractCodexFromText(`Codex usage\nWeekly limit\n39% used\nReset Wednesday`);
  assert.equal(result.quotas.length, 1);
  assert.equal(result.quotas[0].id, 'weekly');
  assert.equal(result.quotas[0].remainingPercent, 61);
});

test('extracts DeepSeek labeled values', () => {
  const result = extractDeepSeekFromText(`账户余额\n¥ 36.82\n今日消耗\n¥ 1.47\n本月消耗\n¥ 18.39\n今日 Token\n1.26M\n缓存命中率\n72.6%`);
  assert.equal(result.balance.value, 36.82);
  assert.equal(result.todayCost.value, 1.47);
  assert.equal(result.todayTokens.value, 1_260_000);
  assert.equal(result.cacheRate.value, 72.6);
});

test('encodes a genuine 8-bit grayscale 600x800 PNG', () => {
  const pixels = new Uint8Array(600 * 800).fill(255);
  for (let y = 100; y < 200; y += 1) pixels.fill(0, y * 600 + 50, y * 600 + 550);
  const png = encodeGrayscalePng(600, 800, pixels);
  const check = verifyKindlePng(png);
  assert.deepEqual(check, { ok: true, width: 600, height: 800, bitDepth: 8, colourType: 0, error: null });
});

test('flattens alpha when converting RGBA', () => {
  assert.deepEqual([...rgbaToGrayscale(Uint8Array.of(0,0,0,255,0,0,0,0))], [0,255]);
});
