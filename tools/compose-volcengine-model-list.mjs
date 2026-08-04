import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const rendererPath = path.join(root, 'web', 'kindle-renderer.js');
const marker = '/* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST */';
let source = fs.readFileSync(rendererPath, 'utf8').replaceAll('\r\n', '\n');

if (!source.includes(marker)) {
  const layout = `export function volcengineModelLayoutPlan(boxHeight, modelCount) {
  const count = Math.max(0, Number(modelCount) || 0);
  if (!count) return { hasModels: false, quotaHeight: Math.max(0, boxHeight - 45), columns: 0, rows: 0, capacity: 0, visibleCount: 0, overflowCount: 0, rowHeight: 0, fontSize: 0 };
  const compact = boxHeight < 210;
  const medium = boxHeight < 340;
  const quotaHeight = compact ? 46 : medium ? 62 : 96;
  const sectionGap = compact ? 4 : medium ? 6 : 9;
  const modelHeaderHeight = compact ? 11 : 15;
  const modelAreaHeight = Math.max(24, boxHeight - 39 - quotaHeight - sectionGap - 8);
  const columns = count === 1
    ? 1
    : compact
      ? (count <= 3 ? 1 : count <= 10 ? 2 : 3)
      : (count <= 4 ? 2 : count <= 9 ? 3 : 4);
  const rows = Math.max(1, Math.ceil(count / columns));
  const rowHeight = Math.max(7, (modelAreaHeight - modelHeaderHeight) / rows);
  const fontSize = clamp(rowHeight - 1, 7, compact ? 9 : 11);
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

  const layoutPattern = /export function volcengineModelLayoutPlan\(boxHeight, modelCount\) \{[\s\S]*?\n\}\n\n(?=function drawVolcengineQuotaStrip)/;
  if (!layoutPattern.test(source)) throw new Error('Volcengine layout plan marker changed');
  source = source.replace(layoutPattern, layout);

  const textList = `${marker}
function drawVolcengineModels(ctx, models, box, y, height, plan) {
  drawText(ctx, '模型 TOKEN', box.x + 12, y, plan.compact ? 8.5 : 10.5, 800, 'left', PALETTE.dark);
  drawText(ctx, \`${'${models.length}'} 个模型 · 全部显示\`, box.x + box.width - 12, y, plan.compact ? 8 : 9.5, 650, 'right', PALETTE.dark);
  const gridY = y + plan.modelHeaderHeight;
  const gridWidth = box.width - 24;
  const columnGap = plan.compact ? 12 : 18;
  const columnWidth = (gridWidth - columnGap * (plan.columns - 1)) / plan.columns;
  const nameSize = plan.fontSize;
  const tokenSize = Math.min(plan.fontSize + 0.5, plan.compact ? 9.5 : 11.5);
  const tokenReserve = plan.compact ? 52 : 66;
  const maxNameLength = Math.max(7, Math.floor((columnWidth - tokenReserve) / Math.max(4.5, nameSize * 0.55)));

  models.forEach((model, index) => {
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    const left = box.x + 12 + column * (columnWidth + columnGap);
    const top = gridY + row * plan.rowHeight;
    const textY = top + Math.max(0, (plan.rowHeight - nameSize) / 2);
    drawText(ctx, shorten(model.name, maxNameLength), left, textY, nameSize, 700, 'left', PALETTE.dark);
    drawText(ctx, formatTokens(model.totalTokens), left + columnWidth, textY - 0.3, tokenSize, 850, 'right');
  });
}

`;

  const drawPattern = /function drawVolcengineModels\(ctx, models, box, y, height, plan\) \{[\s\S]*?\n\}\n\n(?=function drawVolcengine\(ctx)/;
  if (!drawPattern.test(source)) throw new Error('Volcengine model renderer marker changed');
  source = source.replace(drawPattern, textList);
}

if (!source.includes(marker)) throw new Error('Volcengine text model list was not composed');
if (source.includes('其余 ${entry.count} 个模型')) throw new Error('Volcengine overflow placeholder is still active');
fs.writeFileSync(rendererPath, source);
console.log('Composed all-model Volcengine text list');
