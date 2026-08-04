import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

test('all three source controls expose actionable connection states', () => {
  assert.match(html, /id="codex-connection"/);
  assert.match(html, /id="deepseek-connection"/);
  assert.match(html, /id="volcengine-connection"/);
  assert.match(app, /status\.textContent = '已连接'/);
  assert.match(app, /status\.textContent = '未读取到用量'/);
  assert.match(app, /status\.textContent = '需要登录或导航'/);
  assert.match(app, /Agent Plan 企业版的“用量统计”/);
});
