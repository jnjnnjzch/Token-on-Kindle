import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const rendererPath = path.join(root, 'web', 'kindle-renderer.js');
const marker = '/* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST */';
let source = fs.readFileSync(rendererPath, 'utf8').replaceAll('\r\n', '\n');

function replaceBlock(input, startMarker, endMarker, replacement, label) {
  const start = input.indexOf(startMarker);
  if (start < 0) throw new Error(`${label} start marker changed`);
  const end = input.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label} end marker changed`);
  return `${input.slice(0, start)}${replacement.trimEnd()}\n\n${input.slice(end)}`;
}

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
}`;

const textList = `${marker}
function drawVolcengineModels(ctx, models, box, y, height, plan) {
  drawText(ctx, '今日模型 TOKEN', box.x + 12, y, plan.compact ? 9.5 : 11, 850, 'left', PALETTE.ink);
  drawText(ctx, '今日调用 ' + models.length + ' 个', box.x + box.width - 12, y + 0.5, plan.compact ? 8.5 : 10, 750, 'right', PALETTE.dark);
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
}`;

source = replaceBlock(source, 'export function volcengineModelLayoutPlan(boxHeight, modelCount) {', 'function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {', layout, 'Volcengine layout');
source = replaceBlock(source, marker, 'function drawVolcengine(ctx, volcengine, box) {', textList, 'Volcengine model list');

if (!source.includes("drawText(ctx, '今日模型 TOKEN'")) throw new Error('Volcengine today heading missing');
if (!source.includes("'今日调用 ' + models.length + ' 个'")) throw new Error('Volcengine today count missing');
if (!source.includes('formatTokens(model.latestTokens)')) throw new Error('Volcengine latest token value missing');
fs.writeFileSync(rendererPath, source);
console.log('Composed today-only Volcengine model list for Kindle 7');
