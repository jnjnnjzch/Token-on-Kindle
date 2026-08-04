import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const write = (relative, content) => fs.writeFileSync(path.join(root, relative), content);

write('tests/monthly-summary-renderer.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deepSeekMonthlyMetrics } from '../web/kindle-renderer.js';

const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');

test('Kindle DeepSeek card keeps cumulative and monthly amount statistics', () => {
  assert.deepEqual(deepSeekMonthlyMetrics({ account: {
    cumulativeCost: 286.4,
    monthlyCost: 42.8,
    monthlyTokens: 28400000,
    monthlyRequests: 921
  } }), {
    cumulativeCost: 286.4,
    monthlyCost: 42.8,
    monthlyTokens: 28400000,
    monthlyRequests: 921
  });
  assert.match(renderer, /\\['余额', formatMoney\\(deepseek\\.balance\\)\\]/);
  assert.match(renderer, /\\['今日费用', formatMoney\\(todayCost\\)\\]/);
  assert.match(renderer, /\\['累计费用', formatMoney\\(monthly\\.cumulativeCost\\)\\]/);
  assert.match(renderer, /\\['本月费用', formatMoney\\(monthly\\.monthlyCost\\)\\]/);
  assert.match(renderer, /\\['本月 Token', formatTokens\\(monthly\\.monthlyTokens\\)\\]/);
  assert.match(renderer, /drawMetricGrid\\(ctx, metrics,[\\s\\S]*?, 3\\)/);
});

test('selected-range totals are not substituted for account monthly totals', () => {
  assert.doesNotMatch(renderer, /\\['筛选范围费用'/);
  assert.doesNotMatch(renderer, /\\['筛选范围 Token'/);
  assert.match(renderer, /deepseek\\?\\.account\\?\\.cumulativeCost/);
  assert.match(renderer, /deepseek\\?\\.account\\?\\.monthlyCost/);
  assert.match(renderer, /deepseek\\?\\.account\\?\\.monthlyTokens/);
});
`);

write('tests/source-status-ui.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

test('all three source controls expose actionable connection states', () => {
  assert.match(html, /id="codex-connection"/);
  assert.match(html, /id="deepseek-connection"/);
  assert.match(html, /id="volcengine-connection"/);
  assert.match(app, /status\\.textContent = '已连接'/);
  assert.match(app, /status\\.textContent = '未读取到用量'/);
  assert.match(app, /status\\.textContent = '需要登录或导航'/);
  assert.match(app, /Agent Plan 企业版的“用量统计”/);
});
`);

console.log('Finalized v0.8.0 behavior-based tests.');
