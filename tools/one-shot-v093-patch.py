from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    return text.replace(old, new, 1)


def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker missing')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{label}: end marker missing')
    return text[:start] + replacement.rstrip() + '\n' + text[end:]


renderer_path = Path('web/kindle-renderer.js')
renderer = renderer_path.read_text()
renderer = replace_once(
    renderer,
    """  dark: '#3f3f3f',
  mid: '#777777',
  light: '#d2d2d2',
  paper: '#f2f2f2',""",
    """  dark: '#202020',
  mid: '#4d4d4d',
  light: '#b0b0b0',
  paper: '#ffffff',""",
    'palette'
)
renderer = replace_once(
    renderer,
    "return sources.map(source => ({ codex: 132, deepseek: 294, volcengine: 138 })[source]);",
    "return sources.map(source => ({ codex: 120, deepseek: 294, volcengine: 150 })[source]);",
    'three-source heights'
)

normalize = '''export function normalizeVolcengineModels(volcengine) {
  volcengine = volcengine || {};
  const models = Array.isArray(volcengine.models) ? volcengine.models.filter(Boolean) : [];
  return models.map((model, index) => {
    const inputTokens = numericValue(model.inputTokens);
    const outputTokens = numericValue(model.outputTokens);
    const totalTokens = numericValue(model.totalTokens ?? model.tokens)
      ?? (inputTokens != null || outputTokens != null ? (inputTokens || 0) + (outputTokens || 0) : null);
    return {
      id: String(model.id || model.modelId || index),
      name: String(model.name || model.modelName || model.id || `模型 ${index + 1}`),
      totalTokens,
      latestTokens: numericValue(model.latestTokens),
      inputTokens,
      outputTokens,
      cachedTokens: numericValue(model.cachedTokens),
      requests: numericValue(model.requests),
      afp: numericValue(model.afp)
    };
  })
    .filter(model => model.latestTokens != null && model.latestTokens > 0)
    .sort((a, b) => (b.latestTokens || 0) - (a.latestTokens || 0) || a.name.localeCompare(b.name));
}
'''
renderer = replace_between(
    renderer,
    'export function normalizeVolcengineModels(volcengine) {',
    'export function volcengineModelLayoutPlan(boxHeight, modelCount) {',
    normalize,
    'normalizeVolcengineModels'
)

layout = '''export function volcengineModelLayoutPlan(boxHeight, modelCount) {
  const count = Math.max(0, Number(modelCount) || 0);
  if (!count) return { hasModels: false, quotaHeight: Math.max(0, boxHeight - 45), columns: 0, rows: 0, capacity: 0, visibleCount: 0, overflowCount: 0, rowHeight: 0, fontSize: 0 };
  const compact = boxHeight < 220;
  const medium = boxHeight < 340;
  const quotaHeight = compact ? 44 : medium ? 60 : 92;
  const sectionGap = compact ? 5 : medium ? 7 : 10;
  const modelHeaderHeight = compact ? 14 : 17;
  const modelAreaHeight = Math.max(28, boxHeight - 39 - quotaHeight - sectionGap - 8);
  const columns = count === 1
    ? 1
    : compact
      ? (count <= 2 ? 1 : 2)
      : (count <= 4 ? 2 : count <= 9 ? 3 : 4);
  const rows = Math.max(1, Math.ceil(count / columns));
  const rowHeight = Math.max(8.5, (modelAreaHeight - modelHeaderHeight) / rows);
  const fontSize = clamp(rowHeight - 1, 8.5, compact ? 10.5 : 12);
  return {
    hasModels: true,
    compact,
    medium,
    quotaHeight,
    sectionGap,
    modelHeaderHeight,
    modelAreaHeight,
    columns,
    rows,
    rowHeight,
    fontSize,
    capacity: count,
    visibleCount: count,
    overflowCount: 0
  };
}
'''
renderer = replace_between(
    renderer,
    'export function volcengineModelLayoutPlan(boxHeight, modelCount) {',
    'function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {',
    layout,
    'volcengineModelLayoutPlan'
)

model_draw = '''/* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST */
function drawVolcengineModels(ctx, models, box, y, height, plan) {
  drawText(ctx, '今日模型 TOKEN', box.x + 12, y, plan.compact ? 9.5 : 11, 850, 'left', PALETTE.ink);
  drawText(ctx, `今日调用 ${models.length} 个`, box.x + box.width - 12, y + 0.5, plan.compact ? 8.5 : 10, 750, 'right', PALETTE.dark);
  const gridY = y + plan.modelHeaderHeight;
  const gridWidth = box.width - 24;
  const columnGap = plan.compact ? 20 : 22;
  const columnWidth = (gridWidth - columnGap * (plan.columns - 1)) / plan.columns;
  const nameSize = plan.fontSize;
  const tokenSize = Math.min(plan.fontSize + 1, plan.compact ? 11.5 : 13);
  const tokenReserve = plan.compact ? 62 : 72;
  const maxNameLength = Math.max(8, Math.floor((columnWidth - tokenReserve) / Math.max(4.7, nameSize * 0.56)));

  models.forEach((model, index) => {
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    const left = box.x + 12 + column * (columnWidth + columnGap);
    const top = gridY + row * plan.rowHeight;
    if (row > 0) drawLine(ctx, left, top - 1, left + columnWidth, top - 1, 0.8, PALETTE.light);
    const textY = top + Math.max(0, (plan.rowHeight - nameSize) / 2);
    drawText(ctx, shorten(model.name, maxNameLength), left, textY, nameSize, 750, 'left', PALETTE.ink);
    drawText(ctx, formatTokens(model.latestTokens), left + columnWidth, textY - 0.5, tokenSize, 900, 'right', PALETTE.ink);
  });
}
'''
renderer = replace_between(
    renderer,
    '/* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST */',
    'function drawVolcengine(ctx, volcengine, box) {',
    model_draw,
    'drawVolcengineModels'
)
renderer = replace_once(
    renderer,
    "drawCardTitle(ctx, '火山方舟 AFP', box, models.length ? `Agent Plan · ${models.length} 模型` : 'Agent Plan 企业版');",
    "drawCardTitle(ctx, '火山方舟 AFP', box, models.length ? `Agent Plan · 今日 ${models.length} 模型` : 'Agent Plan 企业版');",
    'Volcengine title'
)
renderer_path.write_text(renderer)

composer = r'''import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const rendererPath = path.join(root, 'web', 'kindle-renderer.js');
const marker = '/* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST */';
let source = fs.readFileSync(rendererPath, 'utf8').replaceAll('\r\n', '\n');

const layout = `export function volcengineModelLayoutPlan(boxHeight, modelCount) {
  const count = Math.max(0, Number(modelCount) || 0);
  if (!count) return { hasModels: false, quotaHeight: Math.max(0, boxHeight - 45), columns: 0, rows: 0, capacity: 0, visibleCount: 0, overflowCount: 0, rowHeight: 0, fontSize: 0 };
  const compact = boxHeight < 220;
  const medium = boxHeight < 340;
  const quotaHeight = compact ? 44 : medium ? 60 : 92;
  const sectionGap = compact ? 5 : medium ? 7 : 10;
  const modelHeaderHeight = compact ? 14 : 17;
  const modelAreaHeight = Math.max(28, boxHeight - 39 - quotaHeight - sectionGap - 8);
  const columns = count === 1
    ? 1
    : compact
      ? (count <= 2 ? 1 : 2)
      : (count <= 4 ? 2 : count <= 9 ? 3 : 4);
  const rows = Math.max(1, Math.ceil(count / columns));
  const rowHeight = Math.max(8.5, (modelAreaHeight - modelHeaderHeight) / rows);
  const fontSize = clamp(rowHeight - 1, 8.5, compact ? 10.5 : 12);
  return {
    hasModels: true,
    compact,
    medium,
    quotaHeight,
    sectionGap,
    modelHeaderHeight,
    modelAreaHeight,
    columns,
    rows,
    rowHeight,
    fontSize,
    capacity: count,
    visibleCount: count,
    overflowCount: 0
  };
}

`;

const textList = `${marker}
function drawVolcengineModels(ctx, models, box, y, height, plan) {
  drawText(ctx, '今日模型 TOKEN', box.x + 12, y, plan.compact ? 9.5 : 11, 850, 'left', PALETTE.ink);
  drawText(ctx, \`今日调用 ${models.length} 个\`, box.x + box.width - 12, y + 0.5, plan.compact ? 8.5 : 10, 750, 'right', PALETTE.dark);
  const gridY = y + plan.modelHeaderHeight;
  const gridWidth = box.width - 24;
  const columnGap = plan.compact ? 20 : 22;
  const columnWidth = (gridWidth - columnGap * (plan.columns - 1)) / plan.columns;
  const nameSize = plan.fontSize;
  const tokenSize = Math.min(plan.fontSize + 1, plan.compact ? 11.5 : 13);
  const tokenReserve = plan.compact ? 62 : 72;
  const maxNameLength = Math.max(8, Math.floor((columnWidth - tokenReserve) / Math.max(4.7, nameSize * 0.56)));

  models.forEach((model, index) => {
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    const left = box.x + 12 + column * (columnWidth + columnGap);
    const top = gridY + row * plan.rowHeight;
    if (row > 0) drawLine(ctx, left, top - 1, left + columnWidth, top - 1, 0.8, PALETTE.light);
    const textY = top + Math.max(0, (plan.rowHeight - nameSize) / 2);
    drawText(ctx, shorten(model.name, maxNameLength), left, textY, nameSize, 750, 'left', PALETTE.ink);
    drawText(ctx, formatTokens(model.latestTokens), left + columnWidth, textY - 0.5, tokenSize, 900, 'right', PALETTE.ink);
  });
}

`;

const layoutPattern = /export function volcengineModelLayoutPlan\(boxHeight, modelCount\) \{[\s\S]*?\n\}\n\n(?=function drawVolcengineQuotaStrip)/;
if (!layoutPattern.test(source)) throw new Error('Volcengine layout plan marker changed');
source = source.replace(layoutPattern, layout);

const drawPattern = /(?:\/\* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST \*\/\n)?function drawVolcengineModels\(ctx, models, box, y, height, plan\) \{[\s\S]*?\n\}\n\n(?=function drawVolcengine\(ctx\))/;
if (!drawPattern.test(source)) throw new Error('Volcengine model renderer marker changed');
source = source.replace(drawPattern, textList);

if (!source.includes(marker)) throw new Error('Volcengine text model list was not composed');
if (!source.includes("drawText(ctx, '今日模型 TOKEN'")) throw new Error('Volcengine today heading missing');
if (!source.includes('formatTokens(model.latestTokens)')) throw new Error('Volcengine latest token value missing');
if (source.includes('其余 ${entry.count} 个模型')) throw new Error('Volcengine overflow placeholder is still active');
fs.writeFileSync(rendererPath, source);
console.log('Composed today-only Volcengine model list for Kindle 7');
'''
Path('tools/compose-volcengine-model-list.mjs').write_text(composer)

tests_path = Path('tests/volcengine-model-usage-v083.test.mjs')
tests = tests_path.read_text()
tests = replace_once(tests, 'assert.deepEqual(boxes.map(box => box.height), [132, 294, 138]);', 'assert.deepEqual(boxes.map(box => box.height), [120, 294, 150]);', 'test heights')
tests = replace_once(tests, 'const compact = volcengineModelLayoutPlan(138, 6);', 'const compact = volcengineModelLayoutPlan(150, 6);', 'test compact height')
tests = replace_once(tests, 'assert.match(renderer, /全部显示/);', "assert.match(renderer, /今日模型 TOKEN/);\n  assert.match(renderer, /今日调用/);\n  assert.match(renderer, /formatTokens\\(model\\.latestTokens\\)/);", 'test renderer text')
pattern = re.compile(r"test\('renderer normalizes and sorts arbitrary Volcengine model counts', \(\) => \{.*?\n\}\);", re.S)
replacement = """test('renderer keeps only models with latest token usage and sorts by today tokens', () => {
  const models = normalizeVolcengineModels({ models: [
    { name: '本月有量但今日无调用', totalTokens: 9000, latestTokens: 0 },
    { name: '今日模型 B', totalTokens: 100, latestTokens: 15 },
    { name: '今日模型 A', totalTokens: 50, latestTokens: 80 },
    { name: '缺少今日点', totalTokens: 700 }
  ] });
  assert.deepEqual(models.map(model => model.name), ['今日模型 A', '今日模型 B']);
  assert.deepEqual(models.map(model => model.latestTokens), [80, 15]);
  assert.equal(models[0].totalTokens, 50);
});"""
tests, count = pattern.subn(replacement, tests, count=1)
if count != 1:
    raise SystemExit(f'normalize test: expected one match, got {count}')
tests_path.write_text(tests)

Path('tests/volcengine-today-display-v093.test.mjs').write_text(r"""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeVolcengineModels, sourceLayoutBoxes, volcengineModelLayoutPlan } from '../web/kindle-renderer.js';

test('today-only Volcengine display excludes monthly-only and zero-latest models', () => {
  const models = normalizeVolcengineModels({ models: [
    { name: 'monthly-only', totalTokens: 5000 },
    { name: 'zero-today', totalTokens: 4000, latestTokens: 0 },
    { name: 'active-small', totalTokens: 1000, latestTokens: 12 },
    { name: 'active-large', totalTokens: 900, latestTokens: 120 }
  ] });
  assert.deepEqual(models.map(model => model.name), ['active-large', 'active-small']);
  assert.deepEqual(models.map(model => model.latestTokens), [120, 12]);
});

test('Kindle 7 three-source layout gives Volcengine more room and readable type', () => {
  const boxes = sourceLayoutBoxes({ codex: true, deepseek: true, volcengine: true });
  assert.deepEqual(boxes.map(box => box.height), [120, 294, 150]);
  assert.equal(boxes.at(-1).y + boxes.at(-1).height, 666);
  const plan = volcengineModelLayoutPlan(150, 8);
  assert.equal(plan.columns, 2);
  assert.equal(plan.rows, 4);
  assert.ok(plan.fontSize >= 8.5);
  assert.ok(plan.modelAreaHeight >= 50);
});

test('generated renderer labels and displays latest token values', async () => {
  const renderer = await readFile(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');
  const start = renderer.indexOf('/* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST */');
  const end = renderer.indexOf('\nfunction drawVolcengine(ctx', start);
  const block = renderer.slice(start, end);
  assert.match(block, /今日模型 TOKEN/);
  assert.match(block, /今日调用/);
  assert.match(block, /formatTokens\(model\.latestTokens\)/);
  assert.doesNotMatch(block, /formatTokens\(model\.totalTokens\)/);
});
""")

print('Applied v0.9.3 Volcengine today-only display and Kindle 7 layout patch')
