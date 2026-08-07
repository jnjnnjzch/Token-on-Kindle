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

const kindleLayout = `export const KINDLE_LAYOUT = Object.freeze({
  width: 600,
  height: 800,
  contentTop: 68,
  contentBottom: 706,
  unlockTop: 716,
  unlockHeight: 84
});`;

const preferredLayout = `function preferredHeights(sources) {
  if (sources.length === 1) return [KINDLE_LAYOUT.contentBottom - KINDLE_LAYOUT.contentTop];
  if (sources.length === 2 && sources.includes('deepseek')) {
    return sources.map(source => source === 'deepseek' ? 390 : 238);
  }
  if (sources.length === 2) return [314, 314];
  return sources.map(source => ({ codex: 124, deepseek: 318, volcengine: 188 })[source]);
}`;

const cardTitleRenderer = `function drawCardTitle(ctx, title, box, subtitle = '') {
  drawText(ctx, title, box.x + 12, box.y + 2, 20, 850);
  if (subtitle) drawText(ctx, subtitle, box.x + box.width - 12, box.y + 6, 12, 700, 'right', PALETTE.dark);
  drawLine(ctx, box.x + 12, box.y + 29, box.x + box.width - 12, box.y + 29, 1.5, PALETTE.dark);
}`;

const codexRenderer = `function drawCodexQuotaColumn(ctx, quota, x, y, width, height, label, primary = false) {
  if (!quota) return;
  const remaining = quotaRemaining(quota);
  const used = numericValue(quota?.usedPercent) ?? (remaining == null ? null : 100 - remaining);
  const labelSize = primary ? 14 : 12.5;
  const valueSize = primary ? 34 : 25;
  drawText(ctx, label, x + 10, y + 3, labelSize, 800, 'left', PALETTE.dark);
  drawText(ctx, formatPercent(remaining), x + width - 10, y - 1, valueSize, 900, 'right');

  const barY = y + (primary ? 37 : 31);
  drawBar(ctx, x + 10, barY, width - 20, primary ? 11 : 9, remaining == null ? 0 : remaining / 100);
  const detailY = barY + (primary ? 15 : 13);
  drawText(ctx, used == null ? '已用 —' : '已用 ' + formatPercent(used), x + 10, detailY, primary ? 12 : 11, 700, 'left', PALETTE.dark);
  if (quota?.resetText) {
    drawText(ctx, shorten(quota.resetText, primary ? 34 : 18), x + width - 10, detailY, primary ? 12 : 10.5, 650, 'right', PALETTE.dark);
  }
}

function drawCodex(ctx, codex, box) {
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, null, 0);
  drawCardTitle(ctx, 'CODEX', box);
  const { weekly, hourly } = selectCodexQuotas(codex);
  const bodyY = box.y + 33;
  const bodyHeight = box.height - 37;

  if (!weekly && !hourly) {
    drawText(ctx, '尚未同步', box.x + 12, bodyY + 18, 26, 850);
    return;
  }

  if (weekly && hourly) {
    const columnGap = 12;
    const half = (box.width - columnGap) / 2;
    drawCodexQuotaColumn(ctx, weekly, box.x, bodyY + 4, half, bodyHeight, '周额度', false);
    drawLine(ctx, box.x + half + columnGap / 2, bodyY + 2, box.x + half + columnGap / 2, box.y + box.height - 7, 1, PALETTE.light);
    drawCodexQuotaColumn(ctx, hourly, box.x + half + columnGap, bodyY + 4, half, bodyHeight, quotaLabel(hourly, '5 小时额度'), false);
    return;
  }

  const quota = weekly || hourly;
  drawCodexQuotaColumn(ctx, quota, box.x, bodyY + 3, box.width, bodyHeight, weekly ? '周额度' : quotaLabel(hourly, '小时额度'), true);
}`;

const deepseekPlan = `export function deepSeekLayoutPlan(boxHeight) {
  const bodyHeight = Math.max(0, boxHeight - 34);
  const summaryHeight = clamp(Math.round(bodyHeight * 0.30), 78, 86);
  const sectionGap = 5;
  const modelHeight = Math.max(82, (bodyHeight - summaryHeight - sectionGap - 5) / 2);
  return { bodyHeight, summaryHeight, sectionGap, modelHeight };
}`;

const deepseekRenderer = `function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {
  const rows = Math.ceil(metrics.length / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const labelSize = cellHeight < 41 ? 11 : 11.5;
  const valueSize = cellHeight < 41 ? 17 : 18.5;
  metrics.forEach(([label, value], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = x + column * cellWidth;
    const top = y + row * cellHeight;
    const center = left + cellWidth / 2;
    if (column > 0) drawLine(ctx, left, top + 4, left, top + cellHeight - 4, 0.8, PALETTE.light);
    if (row > 0) drawLine(ctx, left + 7, top, left + cellWidth - 7, top, 0.8, PALETTE.light);
    drawText(ctx, label, center, top + 2, labelSize, 700, 'center', PALETTE.dark);
    drawText(ctx, value, center, top + 17, valueSize, 850, 'center');
  });
}

function drawModelRow(ctx, model, title, x, y, width, height) {
  const totalSize = height < 90 ? 19 : 21;
  const detailSize = height < 90 ? 12.5 : 13.5;
  const cacheSize = height < 90 ? 11.5 : 12.5;

  drawText(ctx, title, x, y + 2, 15.5, 850, 'left');
  drawText(ctx, '总 ' + formatTokens(model.tokens) + ' TOKEN', x + Math.min(142, width * 0.31), y, totalSize, 900, 'left');
  drawText(ctx, formatMoney(model.cost), x + width, y + 3, 15.5, 850, 'right');

  const detailY = y + 31;
  drawText(ctx, '未缓存 ' + formatTokens(model.cacheMissTokens), x, detailY, detailSize, 750, 'left', PALETTE.dark);
  drawText(ctx, '已缓存 ' + formatTokens(model.cacheHitTokens), x + width / 2, detailY, detailSize, 750, 'center', PALETTE.dark);
  drawText(ctx, '输出 ' + formatTokens(model.outputTokens), x + width, detailY, detailSize, 750, 'right', PALETTE.dark);

  const cacheY = y + 54;
  drawText(ctx, '缓存率 ' + formatPercent(model.cacheRate), x, cacheY, cacheSize, 750, 'left', PALETTE.dark);
  drawBar(ctx, x + 92, cacheY + 2, width - 92, 9, cacheRateToRatio(model.cacheRate));

  if (height > 82) drawLine(ctx, x, y + height - 2, x + width, y + height - 2, 0.8, PALETTE.light);
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
  const bodyY = box.y + 32;
  drawMetricGrid(ctx, metrics, box.x + 8, bodyY, box.width - 16, plan.summaryHeight, 3);
  const modelY = bodyY + plan.summaryHeight + plan.sectionGap;
  const modelX = box.x + 12;
  const modelWidth = box.width - 24;
  drawModelRow(ctx, flash, 'V4 FLASH', modelX, modelY, modelWidth, plan.modelHeight);
  drawModelRow(ctx, pro, 'V4 PRO', modelX, modelY + plan.modelHeight, modelWidth, plan.modelHeight);
}`;

const layout = `export function volcengineModelLayoutPlan(boxHeight, modelCount) {
  const count = Math.max(0, Number(modelCount) || 0);
  if (!count) return { hasModels: false, quotaHeight: Math.max(0, boxHeight - 36), columns: 0, rows: 0, capacity: 0, visibleCount: 0, overflowCount: 0, rowHeight: 0, fontSize: 0 };
  const compact = boxHeight < 230;
  const medium = boxHeight < 350;
  const quotaHeight = compact ? 66 : medium ? 72 : 94;
  const sectionGap = compact ? 4 : 7;
  const modelHeaderHeight = compact ? 18 : 20;
  const modelAreaHeight = Math.max(36, boxHeight - 34 - quotaHeight - sectionGap - 4);
  const columns = count <= 2 ? 1 : count <= 8 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(count / columns));
  const rowHeight = Math.max(14, (modelAreaHeight - modelHeaderHeight) / rows);
  const fontSize = clamp(rowHeight - 5, 12.5, compact ? 15 : 16);
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

const quotaStrip = `function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {
  const labels = ['5 小时', '一周', '一月'];
  const cellWidth = (box.width - 24) / 3;
  windows.forEach((entry, index) => {
    const left = box.x + 12 + index * cellWidth;
    const center = left + cellWidth / 2;
    if (index > 0) drawLine(ctx, left, y + 3, left, y + height - 3, 0.8, PALETTE.light);
    const usedPercent = numericValue(entry?.usedPercent)
      ?? (numericValue(entry?.used) != null && numericValue(entry?.total) ? numericValue(entry.used) / numericValue(entry.total) * 100 : null);
    const label = entry?.label ? shorten(entry.label.replace('近', ''), 9) : labels[index];
    drawText(ctx, label, center, y + 1, 11.5, 800, 'center', PALETTE.dark);
    drawText(ctx, formatNumber(entry?.used) + ' / ' + formatNumber(entry?.total), center, y + 16, 14.5, 900, 'center');
    const barY = y + 35;
    drawBar(ctx, left + 7, barY, cellWidth - 14, 7, usedPercent == null ? 0 : usedPercent / 100);
    drawText(ctx, '已用 ' + formatPercent(usedPercent), center, barY + 10, 10.5, 700, 'center', PALETTE.dark);
    if (entry?.resetText) drawText(ctx, shorten(entry.resetText, 16), center, barY + 22, 10, 650, 'center', PALETTE.mid);
  });
}`;

const textList = `${marker}
function drawVolcengineModels(ctx, models, box, y, height, plan) {
  drawText(ctx, '今日模型 TOKEN', box.x + 12, y, 12.5, 850, 'left', PALETTE.ink);
  drawText(ctx, '今日调用 ' + models.length + ' 个', box.x + box.width - 12, y + 1, 11.5, 750, 'right', PALETTE.dark);
  const gridY = y + plan.modelHeaderHeight;
  const gridWidth = box.width - 24;
  const columnGap = 24;
  const columnWidth = (gridWidth - columnGap * (plan.columns - 1)) / plan.columns;
  const nameSize = plan.fontSize;
  const tokenSize = Math.min(plan.fontSize + 1.5, 16.5);
  const tokenReserve = plan.compact ? 72 : 84;
  const maxNameLength = Math.max(8, Math.floor((columnWidth - tokenReserve) / Math.max(5.6, nameSize * 0.57)));

  models.forEach((model, index) => {
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    const left = box.x + 12 + column * (columnWidth + columnGap);
    const top = gridY + row * plan.rowHeight;
    if (row > 0) drawLine(ctx, left, top - 1, left + columnWidth, top - 1, 0.8, PALETTE.light);
    const textY = top + Math.max(1, (plan.rowHeight - nameSize) / 2);
    drawText(ctx, shorten(model.name, maxNameLength), left, textY, nameSize, 780, 'left', PALETTE.ink);
    drawText(ctx, formatTokens(model.latestTokens), left + columnWidth, textY - 1, tokenSize, 900, 'right', PALETTE.ink);
  });
}`;

const timeFormatter = `const formatTime = value => {
  if (value == null || value === '') return '未同步';
  const raw = typeof value === 'string' ? value.trim() : value;
  let normalized = raw;
  if (typeof raw === 'string' && /^\\d{10}$/.test(raw)) normalized = Number(raw) * 1000;
  else if (typeof raw === 'string' && /^\\d{13}$/.test(raw)) normalized = Number(raw);
  else if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw < 1e12) normalized = raw * 1000;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '未同步';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};`;

const headerFooter = `function sourceSyncText(state, sources) {
  const labels = { codex: 'C', deepseek: 'D', volcengine: 'V' };
  return sources.map(source => labels[source] + ' ' + formatTime(state[source]?.capturedAt || state[source]?.syncRequestedAt)).join('  ·  ');
}

function drawHeader(ctx, state, sources) {
  drawText(ctx, 'AI 用量', 28, 11, 36, 850);
  drawText(ctx, sourceSyncText(state, sources), 572, 25, 13, 750, 'right', PALETTE.dark);
  drawLine(ctx, 28, 58, 572, 58, 3);
}

function drawFooter(ctx) {
  ctx.fillStyle = PALETTE.unlock;
  ctx.fillRect(0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockHeight);
  drawLine(ctx, 0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockTop, 2, PALETTE.ink);
}`;

const codexStart = source.includes('function drawCodexQuotaColumn(ctx, quota, x, y, width, height, label, primary = false) {')
  ? 'function drawCodexQuotaColumn(ctx, quota, x, y, width, height, label, primary = false) {'
  : source.includes('function drawCodexQuotaRow(ctx, quota, x, y, width, height, label, primary = false) {')
    ? 'function drawCodexQuotaRow(ctx, quota, x, y, width, height, label, primary = false) {'
    : 'function drawQuota(ctx, quota, x, y, width, height, fallbackLabel) {';
const headerStart = source.includes('function sourceSyncText(state, sources) {')
  ? 'function sourceSyncText(state, sources) {'
  : 'function drawHeader(ctx, sources) {';

source = replaceBlock(source, 'export const KINDLE_LAYOUT = Object.freeze({', 'export const SOURCE_ORDER = Object.freeze(', kindleLayout, 'Kindle canvas layout');
source = replaceBlock(source, 'function preferredHeights(sources) {', 'export function sourceLayoutBoxes(displaySources = {}) {', preferredLayout, 'Source layout heights');
source = replaceBlock(source, 'function drawCardTitle(ctx, title, box, subtitle = \'\') {', 'function quotaRemaining(quota) {', cardTitleRenderer, 'Section title typography');
source = replaceBlock(source, codexStart, 'function modelMetrics(deepseek, key) {', codexRenderer, 'Codex quota layout');
source = replaceBlock(source, 'export function deepSeekLayoutPlan(boxHeight) {', 'function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {', deepseekPlan, 'DeepSeek layout plan');
source = replaceBlock(source, 'function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {', 'function normalizeVolcengineWindows(volcengine) {', deepseekRenderer, 'DeepSeek large-type layout');
source = replaceBlock(source, 'export function volcengineModelLayoutPlan(boxHeight, modelCount) {', 'function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {', layout, 'Volcengine layout');
source = replaceBlock(source, 'function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {', 'function drawVolcengineModelCell(ctx, model, x, y, width, height, compact) {', quotaStrip, 'Volcengine quota typography');
source = replaceBlock(source, marker, 'function drawVolcengine(ctx, volcengine, box) {', textList, 'Volcengine model list');
source = replaceBlock(source, 'const formatTime = value => {', 'const shorten = (value, maxLength = 24) => {', timeFormatter, 'Sync time formatter');
source = replaceBlock(source, headerStart, 'export function renderKindleDashboard(ctx, state = {}) {', headerFooter, 'Kindle header and footer');

if (source.includes('drawHeader(ctx, sources);')) source = source.replace('drawHeader(ctx, sources);', 'drawHeader(ctx, state, sources);');
source = source.replaceAll('drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.paper, PALETTE.ink, 2);', 'drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.paper, null, 0);');
source = source.replaceAll('drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, PALETTE.ink, 2);', 'drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, null, 0);');
source = source.replaceAll('drawBox(ctx, x, y, width, height, PALETTE.white, PALETTE.dark, 1.5);', 'drawBox(ctx, x, y, width, height, PALETTE.white, null, 0);');

if (!source.includes('drawHeader(ctx, state, sources);')) throw new Error('Dashboard must pass state into the compact header');
if (!source.includes('contentTop: 68')) throw new Error('Portrait dashboard content should start immediately below the header');
if (!source.includes('contentBottom: 706')) throw new Error('Dashboard should reclaim the old footer timestamp area');
if (!source.includes('codex: 124, deepseek: 318, volcengine: 188')) throw new Error('Three-source layout must spend reclaimed space on larger readable type');
if (!source.includes("drawText(ctx, title, box.x + 12, box.y + 2, 20")) throw new Error('Source headings must use large Kindle-readable type');
if (!source.includes("drawText(ctx, '总 ' + formatTokens(model.tokens) + ' TOKEN'")) throw new Error('DeepSeek model rows must expose total tokens prominently');
if (!source.includes("'未缓存 ' + formatTokens(model.cacheMissTokens)")) throw new Error('DeepSeek uncached tokens must remain visible');
if (!source.includes("'已缓存 ' + formatTokens(model.cacheHitTokens)")) throw new Error('DeepSeek cached tokens must remain visible');
if (!source.includes("'输出 ' + formatTokens(model.outputTokens)")) throw new Error('DeepSeek output tokens must remain visible');
if (!source.includes("'缓存率 ' + formatPercent(model.cacheRate)")) throw new Error('DeepSeek cache rate must remain visible');
if (!source.includes("if (!weekly && !hourly)")) throw new Error('Codex must handle missing quota data without rendering fake rows');
if (source.includes("quota ? formatPercent(remaining) : '—'")) throw new Error('Missing Codex quota rows must not render placeholder values');
if (!source.includes("drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, null, 0);")) throw new Error('Top-level Kindle sections should be borderless');
if (!source.includes('capturedAt || state[source]?.syncRequestedAt')) throw new Error('Header sync time must prefer successful capture time');
if (!source.includes("/^\\d{10}$/.test(raw)")) throw new Error('Sync time must support Unix-second timestamps');
if (!source.includes('ctx.fillRect(0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockHeight)')) throw new Error('Kindle unlock shelf must remain intact');
if (!source.includes("drawText(ctx, '今日模型 TOKEN'")) throw new Error('Volcengine today heading missing');
if (!source.includes("'今日调用 ' + models.length + ' 个'")) throw new Error('Volcengine today count missing');
if (!source.includes('formatTokens(model.latestTokens)')) throw new Error('Volcengine latest token value missing');

fs.writeFileSync(rendererPath, source);
console.log('Composed large-type portrait Kindle renderer with full information density');
