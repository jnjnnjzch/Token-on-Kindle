import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRefreshInterval } from '../web/kindle-renderer.js';

test('refresh interval label handles minutes and hours', () => {
  assert.equal(formatRefreshInterval(1), '每 1 分钟自动更新');
  assert.equal(formatRefreshInterval(10), '每 10 分钟自动更新');
  assert.equal(formatRefreshInterval(60), '每 1 小时自动更新');
  assert.equal(formatRefreshInterval(90), '每 1 小时 30 分钟自动更新');
});

test('refresh interval label falls back safely', () => {
  assert.equal(formatRefreshInterval(null), '每 10 分钟自动更新');
  assert.equal(formatRefreshInterval({ value: 30 }), '每 30 分钟自动更新');
});
