import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { balancedVerticalFlow, deepSeekLayoutPlan } from '../web/kindle-renderer.js';

const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('balanced vertical flow keeps internal gaps equal and bounded', () => {
  const compact = balancedVerticalFlow(160, [15, 38, 39, 24], { padding: 7, minGap: 4, maxGap: 11 });
  assert.ok(compact.gap >= 4 && compact.gap <= 11);
  const positions = compact.positions;
  const gaps = positions.slice(1).map((position, index) => position - positions[index] - [15, 38, 39][index]);
  gaps.forEach(gap => assert.ok(Math.abs(gap - compact.gap) < 0.001));

  const spacious = balancedVerticalFlow(420, [17, 46, 45, 27], { padding: 9, minGap: 6, maxGap: 18 });
  assert.equal(spacious.gap, 18);
  assert.ok(spacious.offset > 9, 'surplus space should center the content group instead of creating one giant gap');
});

test('DeepSeek summary and model sections adapt across all card heights', () => {
  const compact = deepSeekLayoutPlan(294);
  const medium = deepSeekLayoutPlan(348);
  const full = deepSeekLayoutPlan(584);
  assert.deepEqual(compact, { bodyHeight: 250, summaryHeight: 85, sectionGap: 8, modelHeight: 157 });
  assert.ok(medium.summaryHeight > compact.summaryHeight);
  assert.ok(medium.modelHeight > compact.modelHeight);
  assert.equal(full.summaryHeight, 112);
  assert.ok(full.modelHeight > 400);
  assert.match(renderer, /balancedVerticalFlow\(cellHeight/);
  assert.match(renderer, /balancedVerticalFlow\(height, \[headerHeight, totalHeight, breakdownHeight, cacheHeight\]/);
});

test('all sources share one native refresh batch and no page owns a recurring timer', () => {
  assert.doesNotMatch(extractor, /UPDATE_MS|setInterval\(\(\) => collectAndSignal/);
  assert.match(extractor, /updateIntervalMinutes: syncState\.refreshMinutes/);
  assert.match(extractor, /syncRequestedAt: syncState\.syncRequestedAt/);
  assert.match(extractor, /const marker = location\.href;/);
  assert.doesNotMatch(extractor, /document\.body\?\.innerText\?\.length/);

  const refreshBlock = native.match(/fn reload_sources\(app: &AppHandle\)[\s\S]*?#\[cfg\(any/)?.[0] || '';
  assert.match(refreshBlock, /\("codex", "Codex", true\)/);
  assert.match(refreshBlock, /\("deepseek", "DeepSeek", true\)/);
  assert.match(refreshBlock, /\("volcengine", "火山方舟", true\)/);
  assert.doesNotMatch(refreshBlock, /\("volcengine", "火山方舟", false\)/);
  assert.match(refreshBlock, /match background_refresh_window\(/);
  assert.match(refreshBlock, /Err\(error\) => failed\.push/);
  assert.match(extractor, /window\.__TOKEN_ON_KINDLE_SYNC__/);
  assert.match(renderer, /syncRequestedAt \|\| state\[source\]\?\.capturedAt/);
});
