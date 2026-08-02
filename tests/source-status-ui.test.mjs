import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
test('source controls expose real connection states', () => {
  assert.match(html, /id="codex-connection"/); assert.match(html, /id="deepseek-connection"/);
  assert.match(app, /status\.textContent = '已连接'/); assert.match(app, /status\.textContent = '同步失败'/); assert.match(app, /status\.textContent = '需要登录'/);
});
