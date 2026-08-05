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

composer_path = Path('tools/compose-volcengine-model-list.mjs')
composer = composer_path.read_text()
for old, new, label in [
    ('const compact = boxHeight < 210;', 'const compact = boxHeight < 220;', 'composer compact breakpoint'),
    ('const quotaHeight = compact ? 46 : medium ? 62 : 96;', 'const quotaHeight = compact ? 44 : medium ? 60 : 92;', 'composer quota height'),
    ('const sectionGap = compact ? 4 : medium ? 6 : 9;', 'const sectionGap = compact ? 5 : medium ? 7 : 10;', 'composer section gap'),
    ('const modelHeaderHeight = compact ? 11 : 15;', 'const modelHeaderHeight = compact ? 14 : 17;', 'composer model header'),
    ('const modelAreaHeight = Math.max(24, boxHeight - 39 - quotaHeight - sectionGap - 8);', 'const modelAreaHeight = Math.max(28, boxHeight - 39 - quotaHeight - sectionGap - 8);', 'composer model area'),
    ('? (count <= 3 ? 1 : count <= 10 ? 2 : 3)', '? (count <= 2 ? 1 : 2)', 'composer compact columns'),
    ('const rowHeight = Math.max(7, (modelAreaHeight - modelHeaderHeight) / rows);', 'const rowHeight = Math.max(8.5, (modelAreaHeight - modelHeaderHeight) / rows);', 'composer row height'),
    ('const fontSize = clamp(rowHeight - 1, 7, compact ? 9 : 11);', 'const fontSize = clamp(rowHeight - 1, 8.5, compact ? 10.5 : 12);', 'composer font size'),
    ("drawText(ctx, '模型 TOKEN', box.x + 12, y, plan.compact ? 8.5 : 10.5, 800, 'left', PALETTE.dark);", "drawText(ctx, '今日模型 TOKEN', box.x + 12, y, plan.compact ? 9.5 : 11, 850, 'left', PALETTE.ink);", 'composer heading'),
    ("drawText(ctx, \\`${models.length} 个模型 · 全部显示\\`, box.x + box.width - 12, y, plan.compact ? 8 : 9.5, 650, 'right', PALETTE.dark);", "drawText(ctx, \\`今日调用 ${models.length} 个\\`, box.x + box.width - 12, y + 0.5, plan.compact ? 8.5 : 10, 750, 'right', PALETTE.dark);", 'composer count'),
    ('const columnGap = plan.compact ? 12 : 18;', 'const columnGap = plan.compact ? 20 : 22;', 'composer column gap'),
    ('const tokenSize = Math.min(plan.fontSize + 0.5, plan.compact ? 9.5 : 11.5);', 'const tokenSize = Math.min(plan.fontSize + 1, plan.compact ? 11.5 : 13);', 'composer token size'),
    ('const tokenReserve = plan.compact ? 52 : 66;', 'const tokenReserve = plan.compact ? 62 : 72;', 'composer reserve'),
    ('const maxNameLength = Math.max(7, Math.floor((columnWidth - tokenReserve) / Math.max(4.5, nameSize * 0.55)));', 'const maxNameLength = Math.max(8, Math.floor((columnWidth - tokenReserve) / Math.max(4.7, nameSize * 0.56)));', 'composer name length'),
    ("drawText(ctx, shorten(model.name, maxNameLength), left, textY, nameSize, 700, 'left', PALETTE.dark);", "drawText(ctx, shorten(model.name, maxNameLength), left, textY, nameSize, 750, 'left', PALETTE.ink);", 'composer name draw'),
    ("drawText(ctx, formatTokens(model.totalTokens), left + columnWidth, textY - 0.3, tokenSize, 850, 'right');", "drawText(ctx, formatTokens(model.latestTokens), left + columnWidth, textY - 0.5, tokenSize, 900, 'right', PALETTE.ink);", 'composer token draw')
]:
    composer = replace_once(composer, old, new, label)
composer_path.write_text(composer)

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

Path('tests/volcengine-today-display-v093.test.mjs').write_text("""import assert from 'node:assert/strict';
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
