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

const dualSourceRenderer = `const LEGACY_DUAL_PALETTE = Object.freeze({
  dark: '#3f3f3f',
  mid: '#777777',
  light: '#d2d2d2',
  paper: '#f2f2f2'
});

function drawLegacyBar(ctx, x, y, width, height, ratio) {
  ctx.fillStyle = LEGACY_DUAL_PALETTE.light;
  ctx.fillRect(x, y, width, height);
  const filled = Math.round(width * clamp(ratio));
  if (filled > 0) {
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(x, y, filled, height);
  }
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
}

function drawLegacyDualHeader(ctx) {
  drawText(ctx, 'AI 用量', 28, 18, 34, 800);
  drawText(ctx, 'Codex · DeepSeek', 572, 30, 14, 650, 'right', LEGACY_DUAL_PALETTE.dark);
  drawLine(ctx, 28, 68, 572, 68, 3);
}

function drawLegacyQuotaColumn(ctx, quota, x, width, fallbackLabel) {
  const innerLeft = x + 14;
  const innerRight = x + width - 14;
  drawText(ctx, quotaLabel(quota, fallbackLabel), innerLeft, 116, 14, 750, 'left', LEGACY_DUAL_PALETTE.dark);
  if (!quota) {
    drawText(ctx, '未提供', innerLeft, 145, 26, 800);
    drawText(ctx, '登录后自动识别', innerLeft, 199, 12, 600, 'left', LEGACY_DUAL_PALETTE.mid);
    return;
  }
  const remaining = quotaRemaining(quota);
  const used = numericValue(quota.usedPercent) ?? (remaining == null ? null : 100 - remaining);
  drawText(ctx, '剩余', innerLeft, 137, 13, 700, 'left', LEGACY_DUAL_PALETTE.dark);
  drawText(ctx, formatPercent(remaining), innerRight, 128, 36, 850, 'right');
  drawLegacyBar(ctx, innerLeft, 178, width - 28, 14, remaining == null ? 0 : remaining / 100);
  drawText(ctx, used == null ? '已用 —' : '已用 ' + Math.round(used) + '%', innerLeft, 198, 11, 600, 'left', LEGACY_DUAL_PALETTE.dark);
  drawText(ctx, quota.resetText ? '重置 ' + shorten(quota.resetText, width > 300 ? 38 : 22) : '重置时间未知', innerLeft, 216, 11, 600, 'left', LEGACY_DUAL_PALETTE.dark);
}

function drawLegacyCodex(ctx, codex) {
  drawText(ctx, 'CODEX', 28, 82, 15, 750);
  drawBox(ctx, 28, 104, 544, 132, PALETTE.white, PALETTE.ink, 2);
  const { weekly, hourly } = selectCodexQuotas(codex);
  if (!weekly && !hourly) {
    drawText(ctx, '尚未同步', 46, 132, 30, 800);
    drawText(ctx, '打开 Codex Analytics 完成登录', 46, 184, 15, 550, 'left', LEGACY_DUAL_PALETTE.dark);
    return;
  }
  if (weekly && hourly) {
    drawLine(ctx, 300, 116, 300, 224, 2, LEGACY_DUAL_PALETTE.dark);
    drawLegacyQuotaColumn(ctx, hourly, 28, 272, '5 小时额度');
    drawLegacyQuotaColumn(ctx, weekly, 300, 272, '周额度');
    return;
  }
  drawLegacyQuotaColumn(ctx, weekly || hourly, 28, 544, weekly ? '周额度' : '小时额度');
}

function drawLegacyDeepSeekSummary(ctx, deepseek, todayCost, todayTokens) {
  drawText(ctx, 'DEEPSEEK', 28, 246, 15, 750);
  drawBox(ctx, 28, 268, 544, 116, LEGACY_DUAL_PALETTE.paper, PALETTE.ink, 2);
  const topMetrics = [
    ['余额', formatMoney(deepseek.balance)],
    ['今日费用', formatMoney(todayCost)],
    ['今日 Token', formatTokens(todayTokens)]
  ];
  topMetrics.forEach(([label, value], index) => {
    const left = 28 + index * (544 / 3);
    const center = left + 544 / 6;
    drawText(ctx, label, center, 278, 13, 650, 'center', LEGACY_DUAL_PALETTE.dark);
    drawText(ctx, value, center, 300, 24, 800, 'center');
    if (index < 2) drawLine(ctx, left + 544 / 3, 278, left + 544 / 3, 326, 2, LEGACY_DUAL_PALETTE.dark);
  });
  drawLine(ctx, 28, 334, 572, 334, 2, LEGACY_DUAL_PALETTE.dark);
  const monthly = deepSeekMonthlyMetrics(deepseek);
  const bottomMetrics = [
    ['累计费用', formatMoney(monthly.cumulativeCost)],
    ['本月费用', formatMoney(monthly.monthlyCost)],
    ['本月 Token', formatTokens(monthly.monthlyTokens)]
  ];
  bottomMetrics.forEach(([label, value], index) => {
    const left = 28 + index * (544 / 3);
    const center = left + 544 / 6;
    drawText(ctx, label, center, 342, 12, 650, 'center', LEGACY_DUAL_PALETTE.dark);
    drawText(ctx, value, center, 359, 18, 800, 'center');
    if (index < 2) drawLine(ctx, left + 544 / 3, 342, left + 544 / 3, 376, 2, LEGACY_DUAL_PALETTE.dark);
  });
}

function drawLegacyModel(ctx, x, title, model) {
  const y = 396;
  drawBox(ctx, x, y, 264, 178, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, title, x + 14, y + 10, 15, 800);
  drawText(ctx, formatMoney(model.cost), x + 248, y + 10, 18, 800, 'right');
  drawText(ctx, formatTokens(model.tokens), x + 14, y + 38, 28, 850);
  drawText(ctx, '总 TOKEN', x + 14, y + 72, 11, 650, 'left', LEGACY_DUAL_PALETTE.dark);
  drawLine(ctx, x + 14, y + 90, x + 250, y + 90, 2, LEGACY_DUAL_PALETTE.dark);
  const parts = [
    ['未缓存', model.cacheMissTokens],
    ['已缓存', model.cacheHitTokens],
    ['输出', model.outputTokens]
  ];
  parts.forEach(([label, value], index) => {
    const center = x + 14 + (index + 0.5) * (236 / 3);
    drawText(ctx, label, center, y + 97, 10, 650, 'center', LEGACY_DUAL_PALETTE.dark);
    drawText(ctx, formatTokens(value), center, y + 114, 14, 800, 'center');
  });
  drawText(ctx, '缓存率', x + 14, y + 141, 11, 650, 'left', LEGACY_DUAL_PALETTE.dark);
  drawText(ctx, formatPercent(model.cacheRate), x + 250, y + 141, 11, 750, 'right', LEGACY_DUAL_PALETTE.dark);
  drawLegacyBar(ctx, x + 14, y + 160, 236, 10, cacheRateToRatio(model.cacheRate));
}

function drawLegacyMonthlyFallback(ctx, deepseek) {
  const monthly = deepSeekMonthlyMetrics(deepseek);
  const requests = monthly.monthlyRequests;
  const tokens = monthly.monthlyTokens;
  const average = requests && tokens != null ? tokens / requests : null;
  drawBox(ctx, 28, 396, 264, 178, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, '本月 API 请求', 42, 416, 15, 800);
  drawText(ctx, formatNumber(requests), 42, 458, 34, 850);
  drawText(ctx, '内部用量接口汇总', 42, 520, 13, 600, 'left', LEGACY_DUAL_PALETTE.dark);
  drawBox(ctx, 308, 396, 264, 178, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, '平均 Token / 请求', 322, 416, 15, 800);
  drawText(ctx, formatTokens(average), 322, 458, 34, 850);
  drawText(ctx, '本月 Token ÷ 请求数', 322, 520, 13, 600, 'left', LEGACY_DUAL_PALETTE.dark);
}

function drawLegacyCache(ctx, deepseek, flash, pro, dailyMode) {
  drawBox(ctx, 28, 586, 544, 70, LEGACY_DUAL_PALETTE.paper, PALETTE.ink, 2);
  if (!dailyMode) {
    drawText(ctx, '今日 Flash / Pro 明细正在同步', 44, 601, 19, 800);
    drawText(ctx, '本月总览已显示', 556, 605, 13, 600, 'right', LEGACY_DUAL_PALETTE.dark);
    return;
  }
  let cacheRate = numericValue(deepseek.cacheRate);
  if (cacheRate == null) {
    const hit = (flash.cacheHitTokens || 0) + (pro.cacheHitTokens || 0);
    const miss = (flash.cacheMissTokens || 0) + (pro.cacheMissTokens || 0);
    cacheRate = hit + miss > 0 ? hit / (hit + miss) * 100 : null;
  }
  drawText(ctx, '总体缓存命中率', 44, 598, 15, 750);
  drawText(ctx, formatPercent(cacheRate), 556, 594, 25, 850, 'right');
  drawLegacyBar(ctx, 44, 624, 512, 16, cacheRateToRatio(cacheRate));
}

function drawLegacyDualFooter(ctx, state) {
  drawLine(ctx, 28, 668, 572, 668, 2);
  drawText(ctx, 'Codex ' + formatTime(state.codex?.capturedAt || state.codex?.syncRequestedAt), 28, 682, 13, 650, 'left', LEGACY_DUAL_PALETTE.dark);
  drawText(ctx, 'DeepSeek ' + formatTime(state.deepseek?.capturedAt || state.deepseek?.syncRequestedAt), 572, 682, 13, 650, 'right', LEGACY_DUAL_PALETTE.dark);
  ctx.fillStyle = PALETTE.unlock;
  ctx.fillRect(0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockHeight);
  drawLine(ctx, 0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockTop, 2, PALETTE.ink);
}

function renderLegacyCodexDeepSeek(ctx, state) {
  drawLegacyDualHeader(ctx);
  drawLegacyCodex(ctx, state.codex);
  const deepseek = state.deepseek || {};
  const flash = modelMetrics(deepseek, 'flash');
  const pro = modelMetrics(deepseek, 'pro');
  const todayTokens = numericValue(deepseek.todayTokens) ?? ([flash.tokens, pro.tokens].some(value => value != null) ? (flash.tokens || 0) + (pro.tokens || 0) : null);
  const todayCost = numericValue(deepseek.todayCost) ?? ([flash.cost, pro.cost].some(value => value != null) ? (flash.cost || 0) + (pro.cost || 0) : null);
  const dailyMode = [todayTokens, todayCost, flash.tokens, pro.tokens, flash.cost, pro.cost].some(value => value != null);
  drawLegacyDeepSeekSummary(ctx, deepseek, todayCost, todayTokens);
  if (dailyMode) {
    drawLegacyModel(ctx, 28, 'V4 FLASH', flash);
    drawLegacyModel(ctx, 308, 'V4 PRO', pro);
  } else {
    drawLegacyMonthlyFallback(ctx, deepseek);
  }
  drawLegacyCache(ctx, deepseek, flash, pro, dailyMode);
  drawLegacyDualFooter(ctx, state);
}

export function renderKindleDashboard(ctx, state = {}) {
  ctx.fillStyle = PALETTE.white;
  ctx.fillRect(0, 0, KINDLE_LAYOUT.width, KINDLE_LAYOUT.height);
  const sources = resolveDisplaySources(state.displaySources || {});
  const legacyDualSource = sources.length === 2 && sources[0] === 'codex' && sources[1] === 'deepseek';
  if (legacyDualSource) {
    renderLegacyCodexDeepSeek(ctx, state);
    return;
  }
  drawHeader(ctx, state, sources);
  for (const box of sourceLayoutBoxes(state.displaySources || {})) {
    if (box.source === 'codex') drawCodex(ctx, state.codex, box);
    else if (box.source === 'deepseek') drawDeepSeek(ctx, state.deepseek, box);
    else drawVolcengine(ctx, state.volcengine, box);
  }
  drawFooter(ctx);
}`;

source = replaceBlock(source, 'export const KINDLE_LAYOUT = Object.freeze({', 'export const SOURCE_ORDER = Object.freeze(', kindleLayout, 'Kindle canvas layout');
source = replaceBlock(source, 'function preferredHeights(sources) {', 'export function sourceLayoutBoxes(displaySources = {}) {', preferredLayout, 'source layout heights');
source = replaceBlock(source, "function drawCardTitle(ctx, title, box, subtitle = '') {", 'function quotaRemaining(quota) {', cardTitle, 'section title typography');
source = replaceBlock(source, 'export function deepSeekLayoutPlan(boxHeight) {', 'function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {', deepseekPlan, 'DeepSeek layout plan');
source = replaceBlock(source, 'function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {', 'function normalizeVolcengineWindows(volcengine) {', deepseekRenderer, 'DeepSeek side-by-side cards');
source = replaceBlock(source, 'function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {', 'function drawVolcengineModelCell(ctx, model, x, y, width, height, compact) {', quotaStrip, 'Volcengine quota typography');
source = replaceBlock(source, 'function drawVolcengine(ctx, volcengine, box) {', 'function sourceSyncText(state, sources) {', volcengineRenderer, 'Volcengine readable layout');
source = replaceBlock(source, 'function sourceSyncText(state, sources) {', 'export function renderKindleDashboard(ctx, state = {}) {', headerFooter, 'friendly sync header and unlock footer');

const codexOrderBefore = `    drawCodexQuotaColumn(ctx, weekly, box.x, bodyY + 4, half, bodyHeight, '周额度', false);
    drawLine(ctx, box.x + half + columnGap / 2, bodyY + 2, box.x + half + columnGap / 2, box.y + box.height - 7, 1, PALETTE.light);
    drawCodexQuotaColumn(ctx, hourly, box.x + half + columnGap, bodyY + 4, half, bodyHeight, quotaLabel(hourly, '5 小时额度'), false);`;
const codexOrderAfter = `    drawCodexQuotaColumn(ctx, hourly, box.x, bodyY + 4, half, bodyHeight, quotaLabel(hourly, '5 小时额度'), false);
    drawLine(ctx, box.x + half + columnGap / 2, bodyY + 2, box.x + half + columnGap / 2, box.y + box.height - 7, 1, PALETTE.light);
    drawCodexQuotaColumn(ctx, weekly, box.x + half + columnGap, bodyY + 4, half, bodyHeight, '周额度', false);`;
if (!source.includes(codexOrderBefore)) throw new Error('Codex generated quota order changed before v0.9.17 composition');
source = source.replace(codexOrderBefore, codexOrderAfter);

const renderStart = source.indexOf('export function renderKindleDashboard(ctx, state = {}) {');
if (renderStart < 0) throw new Error('Dashboard renderer start changed');
source = `${source.slice(0, renderStart)}${dualSourceRenderer.trimEnd()}\n`;

if (!source.includes('legacyDualSource')) throw new Error('Codex + DeepSeek must use the v0.6.2 dual-source layout');
if (!source.includes("drawLegacyQuotaColumn(ctx, hourly, 28, 272, '5 小时额度')")) throw new Error('5-hour Codex quota must be on the left in dual-source mode');
if (!source.includes("drawLegacyQuotaColumn(ctx, weekly, 300, 272, '周额度')")) throw new Error('Weekly Codex quota must be on the right in dual-source mode');
const dynamicHourly = source.indexOf('drawCodexQuotaColumn(ctx, hourly, box.x, bodyY + 4');
const dynamicWeekly = source.indexOf('drawCodexQuotaColumn(ctx, weekly, box.x + half + columnGap');
if (dynamicHourly < 0 || dynamicWeekly < 0 || dynamicHourly > dynamicWeekly) throw new Error('Dynamic Codex quota order must be 5-hour left, weekly right');
if (!source.includes("drawText(ctx, 'DEEPSEEK', 28, 246, 15, 750)")) throw new Error('Dual-source DeepSeek geometry must match v0.6.2');
if (!source.includes("drawBox(ctx, 28, 268, 544, 116")) throw new Error('Dual-source DeepSeek summary geometry must match v0.6.2');
if (!source.includes("drawBox(ctx, x, y, 264, 178")) throw new Error('Dual-source model cards must match v0.6.2');
if (!source.includes("else drawVolcengine(ctx, state.volcengine, box)")) throw new Error('Volcengine must remain on the current independent renderer');

fs.writeFileSync(rendererPath, source);
