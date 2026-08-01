import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./fixtures/deepseek-usage-snippet.html', import.meta.url), 'utf8');

function parseCostTooltip(text) {
  const compact = text.replace(/\s+/g, ' ');
  const date = compact.match(/20\d{2}-\d{2}-\d{2}/)?.[0] || null;
  const flash = compact.match(/deepseek-v4-flash\s*¥?\s*([\d,.]+)/i);
  const pro = compact.match(/deepseek-v4-pro\s*¥?\s*([\d,.]+)/i);
  return {
    date,
    flash: flash ? Number(flash[1].replaceAll(',', '')) : null,
    pro: pro ? Number(pro[1].replaceAll(',', '')) : null
  };
}

function parseTokenTooltip(text) {
  const total = text.match(/Tokens\s*([\d,]+)/i);
  const hit = text.match(/Cache hit\)\s*([\d,]+)/i);
  const miss = text.match(/Cache miss\)\s*([\d,]+)/i);
  const output = text.match(/Output\s*([\d,]+)/i);
  const value = match => match ? Number(match[1].replaceAll(',', '')) : null;
  const cacheHit = value(hit);
  const cacheMiss = value(miss);
  return {
    total: value(total),
    cacheHit,
    cacheMiss,
    output: value(output),
    cacheRate: cacheHit != null && cacheMiss != null ? cacheHit / (cacheHit + cacheMiss) * 100 : null
  };
}

test('fixture contains the exact balance card without the alert text in its value node', () => {
  assert.match(html, /data-usage-layout-font="value">¥74\.15</);
});

test('parses Flash and Pro daily cost from the chart tooltip', () => {
  const tooltip = html.match(/<div class="usage-cost-tooltip-body">([^<]+)<\/div>/)?.[1] || '';
  assert.deepEqual(parseCostTooltip(tooltip), {
    date: '2026-08-01',
    flash: 1.90,
    pro: 1.51
  });
});

test('parses daily token composition and cache rate', () => {
  const tooltip = '2026-08-01 Tokens 33,236 Input (Cache hit) 19,968 Input (Cache miss) 9,328 Output 3,940';
  const parsed = parseTokenTooltip(tooltip);
  assert.equal(parsed.total, 33_236);
  assert.equal(parsed.cacheHit, 19_968);
  assert.equal(parsed.cacheMiss, 9_328);
  assert.equal(parsed.output, 3_940);
  assert.ok(Math.abs(parsed.cacheRate - 68.16) < 0.02);
});
