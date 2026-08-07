import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const rendererPath = path.join(root, 'web', 'kindle-renderer.js');
let source = fs.readFileSync(rendererPath, 'utf8').replaceAll('\r\n', '\n');

function replaceBlock(input, startMarker, endMarker, replacement, label) {
  const start = input.indexOf(startMarker);
  if (start < 0) throw new Error(`${label} start marker changed`);
  const end = input.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label} end marker changed`);
  return `${input.slice(0, start)}${replacement.trimEnd()}\n\n${input.slice(end)}`;
}

const kindleLayout = `export const KINDLE_LAYOUT = Object.freeze({
  width: 600,
  height: 800,
  contentTop: 68,
  contentBottom: 686,
  unlockTop: 716,
  unlockHeight: 84
});`;

const preferredLayout = `function preferredHeights(sources) {
  const totalHeight = KINDLE_LAYOUT.contentBottom - KINDLE_LAYOUT.contentTop;
  if (sources.length === 1) return [totalHeight];
  if (sources.length === 2 && sources.includes('deepseek')) {
    return sources.map(source => source === 'deepseek' ? 368 : 240);
  }
  if (sources.length === 2) return [304, 304];
  return sources.map(source => ({ codex: 116, deepseek: 306, volcengine: 188 })[source]);
}`;

const cardTitle = `function drawCardTitle(ctx, title, box, subtitle = '') {
  drawText(ctx, title, box.x + 10, box.y + 2, 18, 850);
  if (subtitle) drawText(ctx, subtitle, box.x + box.width - 10, box.y + 6, 11, 720, 'right', PALETTE.dark);
  drawLine(ctx, box.x + 10, box.y + 28, box.x + box.width - 10, box.y + 28, 1.5, PALETTE.dark);
}`;

const deepseekPlan = `export function deepSeekLayoutPlan(boxHeight) {
  const bodyHeight = Math.max(0, boxHeight - 34);
  const summaryHeight = clamp(Math.round(bodyHeight * 0.29), 76, 84);
  const sectionGap = 8;
  const modelHeight = clamp(bodyHeight - summaryHeight - sectionGap - 4, 164, 210);
  return { bodyHeight, summaryHeight, sectionGap, modelHeight };
}`;

const deepseekRenderer = `function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {
  const rows = Math.ceil(metrics.length / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const labelSize = 11;
  const valueSize = cellHeight < 39 ? 16 : 17;
  metrics.forEach(([label, value], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = x + column * cellWidth;
    const top = y + row * cellHeight;
    const center = left + cellWidth / 2;
    if (column > 0) drawLine(ctx, left, top + 4, left, top + cellHeight - 5, 0.8, PALETTE.light);
    if (row > 0) drawLine(ctx, left + 7, top, left + cellWidth - 7, top, 0.8, PALETTE.light);
    drawText(ctx, label, center, top + 1, labelSize, 700, 'center', PALETTE.dark);
    drawText(ctx, value, center, top + 16, valueSize, 860, 'center');
  });
}

function drawModelCard(ctx, model, title, x, y, width, height) {
  drawBox(ctx, x, y, width, height, PALETTE.white, PALETTE.mid, 1);
  const right = x + width;
  const center = x + width / 2;

  drawText(ctx, title, x + 10, y + 8, 15.5, 860);
  drawText(ctx, formatMoney(model.cost), right - 10, y + 8, 13.5, 850, 'right');

  drawText(ctx, '总 Token', x + 10, y + 43, 11.5, 760, 'left', PALETTE.dark);
  drawText(ctx, formatTokens(model.tokens), center, y + 31, 25, 900, 'center');
  drawLine(ctx, x + 10, y + 70, right - 10, y + 70, 0.8, PALETTE.light);

  const innerWidth = width - 20;
  const columnWidth = innerWidth / 3;
  const details = [
    ['未缓存', model.cacheMissTokens],
    ['已缓存', model.cacheHitTokens],
    ['输出', model.outputTokens]
  ];
  details.forEach(([label, value], index) => {
    const columnLeft = x + 10 + index * columnWidth;
    const columnCenter = columnLeft + columnWidth / 2;
    if (index > 0) drawLine(ctx, columnLeft, y + 79, columnLeft, y + 119, 0.8, PALETTE.light);
    drawText(ctx, label, columnCenter, y + 78, 12, 760, 'center', PALETTE.dark);
    drawText(ctx, formatTokens(value), columnCenter, y + 98, 14.5, 860, 'center');
  });

  const cacheY = y + 126;
  drawText(ctx, '缓存率', x + 10, cacheY, 12, 760, 'left', PALETTE.dark);
  drawText(ctx, formatPercent(model.cacheRate), right - 10, cacheY - 1, 14.5, 850, 'right');
  drawBar(ctx, x + 10, cacheY + 20, width - 20, 8, cacheRateToRatio(model.cacheRate));
}

function drawDeepSeek(ctx, deepseek, box) {
  deepseek = deepseek || {};
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.paper, null, 0);
  drawCardTitle(ctx, 'DEEPSEEK', box, '金额 · Flash / Pro Token');
  const flash = modelMetrics(deepseek, 'flash');
  const pro = modelMetrics(deepseek, 'pro');
  const monthly = deepSeekMonthlyMetrics(deepseek);
  const todayTokens = numericValue(deepseek.todayTokens) ?? ([flash.tokens, pro.tokens].some(value => value != null) ? (flash.tokens || 0) + (pro.tokens || 0) : null);
  const todayCost = numericValue(deepseek.todayCost) ?? ([flash.cost, pro.cost].some(value => value != null) ? (flash.cost || 0) + (pro.cost || 0) : null);
  const metrics = [
    ['余额', formatMoney(deepseek.balance)],
    ['今日费用', formatMoney(todayCost)],
    ['今日 Token', formatTokens(todayTokens)],
    ['累计费用', formatMoney(monthly.cumulativeCost)],
    ['本月费用', formatMoney(monthly.monthlyCost)],
    ['本月 Token', formatTokens(monthly.monthlyTokens)]
  ];
  const plan = deepSeekLayoutPlan(box.height);
  const bodyY = box.y + 31;
  drawMetricGrid(ctx, metrics, box.x + 6, bodyY, box.width - 12, plan.summaryHeight, 3);

  const cardY = bodyY + plan.summaryHeight + plan.sectionGap;
  const cardGap = 10;
  const cardWidth = (box.width - 8 - cardGap) / 2;
  drawModelCard(ctx, flash, 'V4 FLASH', box.x + 4, cardY, cardWidth, plan.modelHeight);
  drawModelCard(ctx, pro, 'V4 PRO', box.x + 4 + cardWidth + cardGap, cardY, cardWidth, plan.modelHeight);
}`;

const quotaStrip = `function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {
  const labels = ['5 小时', '一周', '一月'];
  const cellWidth = (box.width - 24) / 3;
  windows.forEach((entry, index) => {
    const left = box.x + 12 + index * cellWidth;
    const center = left + cellWidth / 2;
    if (index > 0) drawLine(ctx, left, y + 4, left, y + height - 4, 0.8, PALETTE.light);
    const usedPercent = numericValue(entry?.usedPercent)
      ?? (numericValue(entry?.used) != null && numericValue(entry?.total) ? numericValue(entry.used) / numericValue(entry.total) * 100 : null);
    const label = entry?.label ? shorten(entry.label.replace('近', ''), 9) : labels[index];
    drawText(ctx, label, center, y + 1, 12, 800, 'center', PALETTE.dark);
    drawText(ctx, formatNumber(entry?.used) + ' / ' + formatNumber(entry?.total), center, y + 17, 14.5, 900, 'center');
    const barY = y + 36;
    drawBar(ctx, left + 7, barY, cellWidth - 14, 8, usedPercent == null ? 0 : usedPercent / 100);
    drawText(ctx, '已用 ' + formatPercent(usedPercent), center, barY + 11, 10.5, 720, 'center', PALETTE.dark);
    if (entry?.resetText) drawText(ctx, shorten(entry.resetText, 16), center, barY + 24, 10.5, 680, 'center', PALETTE.mid);
  });
}`;

const volcengineRenderer = `function drawVolcengine(ctx, volcengine, box) {
  volcengine = volcengine || {};
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, null, 0);
  const models = normalizeVolcengineModels(volcengine);
  drawCardTitle(ctx, '火山方舟 AFP', box, models.length ? 'Agent Plan · 今日 ' + models.length + ' 模型' : 'Agent Plan 企业版');
  const windows = normalizeVolcengineWindows(volcengine);
  if (!windows.some(Boolean)) {
    drawText(ctx, '尚未同步', box.x + 10, box.y + 48, 24, 850);
    return;
  }

  const plan = volcengineModelLayoutPlan(box.height, models.length);
  if (models.length) {
    const quotaY = box.y + 33;
    drawVolcengineQuotaStrip(ctx, windows, box, quotaY, plan.quotaHeight);
    const modelY = quotaY + plan.quotaHeight + plan.sectionGap;
    drawVolcengineModels(ctx, models, box, modelY, plan.modelAreaHeight, plan);
    return;
  }

  const bodyY = box.y + 33;
  const rowHeight = (box.height - 37) / 3;
  const labels = ['近 5 小时', '近一周', '近一月'];
  windows.forEach((entry, index) => {
    const rowY = bodyY + index * rowHeight;
    const usedPercent = numericValue(entry?.usedPercent)
      ?? (numericValue(entry?.used) != null && numericValue(entry?.total) ? numericValue(entry.used) / numericValue(entry.total) * 100 : null);
    drawText(ctx, entry?.label || labels[index], box.x + 8, rowY + 3, 13.5, 800, 'left', PALETTE.dark);
    drawText(ctx, formatNumber(entry?.used) + ' / ' + formatNumber(entry?.total) + ' AFP', box.x + box.width - 8, rowY + 3, 14, 850, 'right');
    const barY = rowY + 23;
    drawBar(ctx, box.x + 8, barY, box.width - 16, 9, usedPercent == null ? 0 : usedPercent / 100);
    if (entry?.resetText) drawText(ctx, shorten(entry.resetText, 38), box.x + box.width - 8, barY + 11, 10.5, 680, 'right', PALETTE.dark);
  });
}`;

const headerFooter = `function sourceSyncText(state, sources) {
  const names = { codex: 'Codex', deepseek: 'DeepSeek', volcengine: '火山方舟' };
  return sources.map(source => names[source] + ' ' + formatTime(state[source]?.capturedAt || state[source]?.syncRequestedAt)).join('  ·  ');
}

function drawHeader(ctx, state, sources) {
  drawText(ctx, 'AI 用量', 22, 11, 32, 850);
  drawText(ctx, sourceSyncText(state, sources), 578, 18, 11, 760, 'right', PALETTE.dark);
  drawLine(ctx, 22, 58, 578, 58, 3);
}

function drawFooter(ctx) {
  ctx.fillStyle = PALETTE.unlock;
  ctx.fillRect(0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockHeight);
}`;

source = replaceBlock(source, 'export const KINDLE_LAYOUT = Object.freeze({', 'export const SOURCE_ORDER = Object.freeze(', kindleLayout, 'Kindle canvas layout');
source = replaceBlock(source, 'function preferredHeights(sources) {', 'export function sourceLayoutBoxes(displaySources = {}) {', preferredLayout, 'source layout heights');
source = replaceBlock(source, "function drawCardTitle(ctx, title, box, subtitle = '') {", 'function quotaRemaining(quota) {', cardTitle, 'section title typography');
source = replaceBlock(source, 'export function deepSeekLayoutPlan(boxHeight) {', 'function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {', deepseekPlan, 'DeepSeek layout plan');
source = replaceBlock(source, 'function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {', 'function normalizeVolcengineWindows(volcengine) {', deepseekRenderer, 'DeepSeek side-by-side cards');
source = replaceBlock(source, 'function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {', 'function drawVolcengineModelCell(ctx, model, x, y, width, height, compact) {', quotaStrip, 'Volcengine quota typography');
source = replaceBlock(source, 'function drawVolcengine(ctx, volcengine, box) {', 'function sourceSyncText(state, sources) {', volcengineRenderer, 'Volcengine readable layout');
source = replaceBlock(source, 'function sourceSyncText(state, sources) {', 'export function renderKindleDashboard(ctx, state = {}) {', headerFooter, 'friendly sync header and unlock footer');

fs.writeFileSync(rendererPath, source);
