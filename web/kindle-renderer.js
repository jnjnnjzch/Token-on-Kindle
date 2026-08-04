const PALETTE = {
  white: '#ffffff',
  ink: '#000000',
  dark: '#3f3f3f',
  mid: '#777777',
  light: '#d2d2d2',
  paper: '#f2f2f2',
  unlock: '#565656'
};

export const KINDLE_LAYOUT = Object.freeze({
  width: 600,
  height: 800,
  contentTop: 82,
  contentBottom: 666,
  unlockTop: 716,
  unlockHeight: 84
});

export const SOURCE_ORDER = Object.freeze(['codex', 'deepseek', 'volcengine']);
export const DEEPSEEK_DETAIL_MIN_HEIGHT = 294;

const numericValue = value => {
  if (value == null) return null;
  const raw = typeof value === 'number' ? value : value.value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function cacheRateToRatio(value) {
  const number = numericValue(value);
  return number == null ? 0 : clamp(number / 100);
}

export function modelTokenBreakdown(source = {}) {
  return {
    cacheMissTokens: numericValue(source.cacheMissTokens),
    cacheHitTokens: numericValue(source.cacheHitTokens),
    outputTokens: numericValue(source.outputTokens)
  };
}

export function selectCodexQuotas(codex = {}) {
  const quotas = Array.isArray(codex?.quotas) ? codex.quotas.filter(Boolean) : [];
  const idOf = item => String(item?.id || '').toLowerCase();
  const hourlyCandidates = quotas.filter(item => /^\d+(?:\.\d+)?h$/.test(idOf(item)));
  const hourly = hourlyCandidates.find(item => idOf(item) === '5h') || hourlyCandidates[0] || null;
  const weekly = quotas.find(item => idOf(item) === 'weekly')
    || quotas.find(item => idOf(item).includes('week'))
    || quotas.find(item => item !== hourly)
    || null;
  return { weekly, hourly };
}

export function deepSeekMonthlyMetrics(deepseek = {}) {
  return {
    cumulativeCost: numericValue(deepseek?.account?.cumulativeCost),
    monthlyCost: numericValue(deepseek?.account?.monthlyCost),
    monthlyTokens: numericValue(deepseek?.account?.monthlyTokens),
    monthlyRequests: numericValue(deepseek?.account?.monthlyRequests)
  };
}

export function deepSeekRangeMetrics(deepseek = {}) {
  return {
    rangeCost: numericValue(deepseek?.range?.cost),
    rangeTokens: numericValue(deepseek?.range?.tokens)
  };
}

export function resolveDisplaySources(displaySources = {}) {
  const selected = SOURCE_ORDER.filter(id => displaySources[id] !== false);
  return selected.length ? selected : ['codex'];
}

function preferredHeights(sources) {
  if (sources.length === 1) return [KINDLE_LAYOUT.contentBottom - KINDLE_LAYOUT.contentTop];
  if (sources.length === 2 && sources.includes('deepseek')) {
    return sources.map(source => source === 'deepseek' ? 348 : 226);
  }
  if (sources.length === 2) return [287, 287];
  return sources.map(source => ({ codex: 132, deepseek: 294, volcengine: 138 })[source]);
}

export function sourceLayoutBoxes(displaySources = {}) {
  const sources = resolveDisplaySources(displaySources);
  const gap = 10;
  const heights = preferredHeights(sources);
  let y = KINDLE_LAYOUT.contentTop;
  return sources.map((source, index) => {
    const box = { source, x: 28, y, width: 544, height: heights[index] };
    y += heights[index] + gap;
    return box;
  });
}

const formatTokens = value => {
  const number = numericValue(value);
  if (number == null) return '—';
  if (Math.abs(number) >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(1)}K`;
  return Math.round(number).toLocaleString();
};

const formatMoney = value => {
  const number = numericValue(value);
  return number == null ? '—' : `¥${number.toFixed(2)}`;
};

const formatNumber = value => {
  const number = numericValue(value);
  if (number == null) return '—';
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatPercent = value => {
  const number = numericValue(value);
  if (number == null) return '—';
  return `${clamp(number, 0, 100).toFixed(Math.abs(number % 1) > 0.05 ? 1 : 0)}%`;
};

const formatTime = value => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '未同步';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const shorten = (value, maxLength = 24) => {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

function font(ctx, size, weight = 600) {
  ctx.font = `${weight} ${size}px system-ui, "Microsoft YaHei", sans-serif`;
  ctx.textBaseline = 'top';
}

function drawText(ctx, value, x, y, size, weight = 600, align = 'left', color = PALETTE.ink) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  font(ctx, size, weight);
  ctx.fillText(String(value), x, y);
}

function drawLine(ctx, x1, y1, x2, y2, width = 2, color = PALETTE.ink) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawBox(ctx, x, y, width, height, fill = PALETTE.white, stroke = PALETTE.ink, lineWidth = 2) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x, y, width, height);
  }
}

function drawBar(ctx, x, y, width, height, ratio, fill = PALETTE.ink) {
  ctx.fillStyle = PALETTE.light;
  ctx.fillRect(x, y, width, height);
  const filled = Math.round(width * clamp(ratio));
  if (filled > 0) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, filled, height);
  }
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, width, height);
}

function drawCardTitle(ctx, title, box, subtitle = '') {
  drawText(ctx, title, box.x + 14, box.y + 10, 14, 800);
  if (subtitle) drawText(ctx, subtitle, box.x + box.width - 14, box.y + 12, 10, 650, 'right', PALETTE.dark);
  drawLine(ctx, box.x + 12, box.y + 34, box.x + box.width - 12, box.y + 34, 1.5, PALETTE.dark);
}

function quotaRemaining(quota) {
  const remaining = numericValue(quota?.remainingPercent);
  if (remaining != null) return clamp(remaining, 0, 100);
  const used = numericValue(quota?.usedPercent);
  if (used != null) return clamp(100 - used, 0, 100);
  const displayed = numericValue(quota?.displayedPercent);
  return displayed == null ? null : clamp(displayed, 0, 100);
}

function quotaLabel(quota, fallback) {
  const id = String(quota?.id || '').toLowerCase();
  if (id === 'weekly' || id.includes('week')) return '周额度';
  const hours = id.match(/^(\d+(?:\.\d+)?)h$/)?.[1];
  if (hours) return `${hours} 小时额度`;
  return fallback;
}

function drawQuota(ctx, quota, x, y, width, height, fallbackLabel) {
  const compact = height < 118;
  const remaining = quotaRemaining(quota);
  const used = numericValue(quota?.usedPercent) ?? (remaining == null ? null : 100 - remaining);
  drawText(ctx, quotaLabel(quota, fallbackLabel), x + 12, y + 8, compact ? 11 : 13, 750, 'left', PALETTE.dark);
  if (!quota) {
    drawText(ctx, '未提供', x + width - 12, y + 7, compact ? 18 : 24, 800, 'right');
    drawText(ctx, '登录后自动识别', x + 12, y + height - 22, 10, 600, 'left', PALETTE.mid);
    return;
  }
  drawText(ctx, formatPercent(remaining), x + width - 12, y + 4, compact ? 24 : 32, 850, 'right');
  const barY = y + (compact ? 42 : 50);
  drawBar(ctx, x + 12, barY, width - 24, compact ? 10 : 13, remaining == null ? 0 : remaining / 100);
  drawText(ctx, used == null ? '已用 —' : `已用 ${formatPercent(used)}`, x + 12, barY + 16, 10, 650, 'left', PALETTE.dark);
  drawText(ctx, quota?.resetText ? shorten(quota.resetText, width > 300 ? 42 : 21) : '重置时间未知', x + width - 12, barY + 16, 10, 600, 'right', PALETTE.dark);
}

function drawCodex(ctx, codex, box) {
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, PALETTE.ink, 2);
  drawCardTitle(ctx, 'CODEX', box, '额度');
  const { weekly, hourly } = selectCodexQuotas(codex);
  if (!weekly && !hourly) {
    drawText(ctx, '尚未同步', box.x + 18, box.y + 55, box.height > 240 ? 32 : 23, 850);
    drawText(ctx, '打开 Codex Analytics，并点击“同步至 Kindle”', box.x + 18, box.y + 94, box.height > 240 ? 14 : 10, 600, 'left', PALETTE.dark);
    return;
  }
  const bodyY = box.y + 40;
  const bodyHeight = box.height - 48;
  if (weekly && hourly) {
    const half = box.width / 2;
    drawLine(ctx, box.x + half, bodyY + 4, box.x + half, box.y + box.height - 10, 1.5, PALETTE.dark);
    drawQuota(ctx, weekly, box.x, bodyY, half, bodyHeight, '周额度');
    drawQuota(ctx, hourly, box.x + half, bodyY, half, bodyHeight, '5 小时额度');
  } else {
    drawQuota(ctx, weekly || hourly, box.x, bodyY, box.width, bodyHeight, weekly ? '周额度' : '小时额度');
  }
}

function modelMetrics(deepseek, key) {
  const source = deepseek?.models?.[key] || {};
  const breakdown = modelTokenBreakdown(source);
  const hit = breakdown.cacheHitTokens;
  const miss = breakdown.cacheMissTokens;
  return {
    tokens: numericValue(source.tokens),
    cost: numericValue(source.cost),
    ...breakdown,
    cacheRate: numericValue(source.cacheRate) ?? (hit != null && miss != null && hit + miss > 0 ? hit / (hit + miss) * 100 : null)
  };
}

export function balancedVerticalFlow(height, blockHeights, options = {}) {
  const padding = options.padding ?? 8;
  const minGap = options.minGap ?? 4;
  const maxGap = options.maxGap ?? 18;
  const blocks = blockHeights.map(value => Math.max(0, Number(value) || 0));
  const gapCount = Math.max(0, blocks.length - 1);
  const innerHeight = Math.max(0, height - padding * 2);
  const blockTotal = blocks.reduce((sum, value) => sum + value, 0);
  const rawGap = gapCount ? (innerHeight - blockTotal) / gapCount : 0;
  const gap = gapCount ? clamp(rawGap, minGap, maxGap) : 0;
  const contentHeight = blockTotal + gap * gapCount;
  const offset = padding + Math.max(0, (innerHeight - contentHeight) / 2);
  let cursor = offset;
  const positions = blocks.map(blockHeight => {
    const position = cursor;
    cursor += blockHeight + gap;
    return position;
  });
  return { positions, gap, offset, contentHeight, innerHeight };
}

export function deepSeekLayoutPlan(boxHeight) {
  const bodyHeight = Math.max(0, boxHeight - 44);
  const summaryHeight = clamp(Math.round(bodyHeight * 0.34), 84, 112);
  const sectionGap = clamp(Math.round(bodyHeight * 0.03), 6, 12);
  const modelHeight = Math.max(146, bodyHeight - summaryHeight - sectionGap);
  return { bodyHeight, summaryHeight, sectionGap, modelHeight };
}

function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {
  const rows = Math.ceil(metrics.length / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const compact = cellHeight < 47;
  const labelSize = compact ? 8.5 : 10.5;
  const valueSize = compact ? 14.5 : 19;
  metrics.forEach(([label, value], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = x + column * cellWidth;
    const top = y + row * cellHeight;
    const center = left + cellWidth / 2;
    if (column > 0) drawLine(ctx, left, top + 5, left, top + cellHeight - 5, 1, PALETTE.dark);
    if (row > 0) drawLine(ctx, left + 5, top, left + cellWidth - 5, top, 1, PALETTE.dark);
    const flow = balancedVerticalFlow(cellHeight, [labelSize + 2, valueSize + 3], {
      padding: compact ? 3 : 5,
      minGap: 2,
      maxGap: 7
    });
    drawText(ctx, label, center, top + flow.positions[0], labelSize, 650, 'center', PALETTE.dark);
    drawText(ctx, value, center, top + flow.positions[1], valueSize, 820, 'center');
  });
}

function drawModelCard(ctx, model, title, x, y, width, height) {
  drawBox(ctx, x, y, width, height, PALETTE.white, PALETTE.dark, 1.5);
  const compact = height < 184;
  const headerHeight = compact ? 15 : 17;
  const totalHeight = compact ? 38 : 46;
  const breakdownHeight = compact ? 39 : 45;
  const cacheHeight = compact ? 24 : 27;
  const flow = balancedVerticalFlow(height, [headerHeight, totalHeight, breakdownHeight, cacheHeight], {
    padding: compact ? 7 : 9,
    minGap: compact ? 4 : 6,
    maxGap: compact ? 11 : 18
  });
  const [headerTop, totalTop, breakdownTop, cacheTop] = flow.positions.map(position => y + position);

  drawText(ctx, title, x + 10, headerTop, compact ? 10.5 : 11, 800);
  drawText(ctx, formatMoney(model.cost), x + width - 10, headerTop - 1, compact ? 11.5 : 12, 800, 'right');

  drawText(ctx, formatTokens(model.tokens), x + 10, totalTop, compact ? 21 : 25, 850);
  drawText(ctx, '总 TOKEN', x + 10, totalTop + (compact ? 25 : 30), 8, 650, 'left', PALETTE.dark);

  drawLine(ctx, x + 10, breakdownTop - Math.max(2, flow.gap / 2), x + width - 10, breakdownTop - Math.max(2, flow.gap / 2), 1, PALETTE.dark);
  const parts = [
    ['未缓存', model.cacheMissTokens],
    ['已缓存', model.cacheHitTokens],
    ['输出', model.outputTokens]
  ];
  const innerWidth = width - 20;
  parts.forEach(([label, value], index) => {
    const center = x + 10 + (index + 0.5) * (innerWidth / 3);
    const partFlow = balancedVerticalFlow(breakdownHeight, [10, compact ? 14 : 16], {
      padding: 1,
      minGap: 2,
      maxGap: 5
    });
    drawText(ctx, label, center, breakdownTop + partFlow.positions[0], 8, 650, 'center', PALETTE.dark);
    drawText(ctx, formatTokens(value), center, breakdownTop + partFlow.positions[1], compact ? 11.5 : 13, 800, 'center');
    if (index > 0) {
      const lineX = x + 10 + index * (innerWidth / 3);
      drawLine(ctx, lineX, breakdownTop + 2, lineX, breakdownTop + breakdownHeight - 2, 1, PALETTE.light);
    }
  });

  drawText(ctx, '缓存率', x + 10, cacheTop, 9, 650, 'left', PALETTE.dark);
  drawText(ctx, formatPercent(model.cacheRate), x + width - 10, cacheTop, 9.5, 750, 'right', PALETTE.dark);
  drawBar(ctx, x + 10, cacheTop + cacheHeight - 8, width - 20, 7, cacheRateToRatio(model.cacheRate));
}

function drawDeepSeek(ctx, deepseek = {}, box) {
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.paper, PALETTE.ink, 2);
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
  const bodyY = box.y + 38;
  drawMetricGrid(ctx, metrics, box.x + 8, bodyY, box.width - 16, plan.summaryHeight, 3);
  const modelY = bodyY + plan.summaryHeight + plan.sectionGap;
  const half = (box.width - 24) / 2;
  drawModelCard(ctx, flash, 'V4 FLASH', box.x + 8, modelY, half, plan.modelHeight);
  drawModelCard(ctx, pro, 'V4 PRO', box.x + 16 + half, modelY, half, plan.modelHeight);
}

function normalizeVolcengineWindows(volcengine = {}) {
  const windows = Array.isArray(volcengine.windows) ? volcengine.windows.filter(Boolean) : [];
  const find = ids => windows.find(item => ids.includes(String(item?.id || '').toLowerCase())) || null;
  return [
    find(['5h', 'five-hour', 'near-5h']) || windows.find(item => /5\s*小时/.test(item?.label || '')),
    find(['weekly', 'week']) || windows.find(item => /一周|周/.test(item?.label || '')),
    find(['monthly', 'month']) || windows.find(item => /一月|月/.test(item?.label || ''))
  ];
}

function drawVolcengine(ctx, volcengine = {}, box) {
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, PALETTE.ink, 2);
  drawCardTitle(ctx, '火山方舟 AFP', box, 'Agent Plan 企业版');
  const windows = normalizeVolcengineWindows(volcengine);
  if (!windows.some(Boolean)) {
    drawText(ctx, '尚未同步', box.x + 18, box.y + 55, box.height > 240 ? 30 : 22, 850);
    drawText(ctx, '进入企业版用量统计，看到 AFP 卡片后点击同步', box.x + 18, box.y + 94, box.height > 240 ? 14 : 10, 600, 'left', PALETTE.dark);
    return;
  }
  const bodyY = box.y + 39;
  const rowHeight = (box.height - 45) / 3;
  const labels = ['近 5 小时', '近一周', '近一月'];
  windows.forEach((entry, index) => {
    const y = bodyY + index * rowHeight;
    if (index > 0) drawLine(ctx, box.x + 12, y, box.x + box.width - 12, y, 1, PALETTE.dark);
    const usedPercent = numericValue(entry?.usedPercent) ?? (numericValue(entry?.used) != null && numericValue(entry?.total) ? numericValue(entry.used) / numericValue(entry.total) * 100 : null);
    drawText(ctx, entry?.label || labels[index], box.x + 14, y + 5, rowHeight < 48 ? 9.5 : 12, 750, 'left', PALETTE.dark);
    drawText(ctx, `${formatNumber(entry?.used)} / ${formatNumber(entry?.total)} AFP`, box.x + box.width - 14, y + 4, rowHeight < 48 ? 10.5 : 14, 800, 'right');
    const barY = y + (rowHeight < 48 ? 23 : 31);
    drawBar(ctx, box.x + 14, barY, box.width - 28, rowHeight < 48 ? 6 : 9, usedPercent == null ? 0 : usedPercent / 100);
    if (rowHeight >= 52) {
      drawText(ctx, `已用 ${formatPercent(usedPercent)}`, box.x + 14, barY + 12, 9, 650, 'left', PALETTE.dark);
      drawText(ctx, entry?.resetText ? shorten(entry.resetText, 28) : '重置时间未知', box.x + box.width - 14, barY + 12, 9, 600, 'right', PALETTE.dark);
    }
  });
}

function drawHeader(ctx, sources) {
  drawText(ctx, 'AI 用量', 28, 18, 34, 800);
  const names = { codex: 'Codex', deepseek: 'DeepSeek', volcengine: '火山方舟' };
  drawText(ctx, sources.map(source => names[source]).join(' · '), 572, 30, 13, 650, 'right', PALETTE.dark);
  drawLine(ctx, 28, 68, 572, 68, 3);
}

function drawFooter(ctx, state, sources) {
  drawLine(ctx, 28, 676, 572, 676, 1.5);
  const labels = { codex: 'C', deepseek: 'D', volcengine: 'V' };
  const text = sources.map(source => `${labels[source]} ${formatTime(state[source]?.syncRequestedAt || state[source]?.capturedAt)}`).join('  ·  ');
  drawText(ctx, text, 300, 686, 11, 650, 'center', PALETTE.dark);
  ctx.fillStyle = PALETTE.unlock;
  ctx.fillRect(0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockHeight);
  drawLine(ctx, 0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockTop, 2, PALETTE.ink);
}

export function renderKindleDashboard(ctx, state = {}) {
  ctx.fillStyle = PALETTE.white;
  ctx.fillRect(0, 0, KINDLE_LAYOUT.width, KINDLE_LAYOUT.height);
  const sources = resolveDisplaySources(state.displaySources || {});
  drawHeader(ctx, sources);
  for (const box of sourceLayoutBoxes(state.displaySources || {})) {
    if (box.source === 'codex') drawCodex(ctx, state.codex, box);
    else if (box.source === 'deepseek') drawDeepSeek(ctx, state.deepseek, box);
    else drawVolcengine(ctx, state.volcengine, box);
  }
  drawFooter(ctx, state, sources);
}
