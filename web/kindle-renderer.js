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
  unlockTop: 716,
  unlockHeight: 84
});

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

export function deepSeekRangeMetrics(deepseek = {}) {
  return {
    rangeCost: numericValue(deepseek?.range?.cost),
    rangeTokens: numericValue(deepseek?.range?.tokens)
  };
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

const formatInteger = value => {
  const number = numericValue(value);
  return number == null ? '—' : Math.round(number).toLocaleString();
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
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
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

function drawHeader(ctx) {
  drawText(ctx, 'AI 用量', 28, 18, 34, 800);
  drawText(ctx, 'Codex · DeepSeek', 572, 30, 14, 650, 'right', PALETTE.dark);
  drawLine(ctx, 28, 68, 572, 68, 3);
}

function drawQuotaColumn(ctx, quota, x, width, fallbackLabel) {
  const innerLeft = x + 14;
  const innerRight = x + width - 14;
  drawText(ctx, quotaLabel(quota, fallbackLabel), innerLeft, 116, 14, 750, 'left', PALETTE.dark);

  if (!quota) {
    drawText(ctx, '未提供', innerLeft, 145, 26, 800);
    drawText(ctx, '登录后自动识别', innerLeft, 199, 12, 600, 'left', PALETTE.mid);
    return;
  }

  const remaining = quotaRemaining(quota);
  const used = numericValue(quota.usedPercent) ?? (remaining == null ? null : 100 - remaining);
  drawText(ctx, '剩余', innerLeft, 137, 13, 700, 'left', PALETTE.dark);
  drawText(ctx, formatPercent(remaining), innerRight, 128, 36, 850, 'right');
  drawBar(ctx, innerLeft, 178, width - 28, 14, remaining == null ? 0 : remaining / 100);
  drawText(ctx, used == null ? '已用 —' : `已用 ${Math.round(used)}%`, innerLeft, 198, 11, 600, 'left', PALETTE.dark);
  drawText(
    ctx,
    quota.resetText ? `重置 ${shorten(quota.resetText, width > 300 ? 38 : 22)}` : '重置时间未知',
    innerLeft,
    216,
    11,
    600,
    'left',
    PALETTE.dark
  );
}

function drawCodex(ctx, codex) {
  drawText(ctx, 'CODEX', 28, 82, 15, 750);
  drawBox(ctx, 28, 104, 544, 132, PALETTE.white, PALETTE.ink, 2);

  const { weekly, hourly } = selectCodexQuotas(codex);
  if (!weekly && !hourly) {
    drawText(ctx, '尚未同步', 46, 132, 30, 800);
    drawText(ctx, '打开 Codex Analytics 完成登录', 46, 184, 15, 550, 'left', PALETTE.dark);
    return;
  }

  if (weekly && hourly) {
    drawLine(ctx, 300, 116, 300, 224, 2, PALETTE.dark);
    drawQuotaColumn(ctx, weekly, 28, 272, '周额度');
    drawQuotaColumn(ctx, hourly, 300, 272, '5 小时额度');
    return;
  }

  drawQuotaColumn(ctx, weekly || hourly, 28, 544, weekly ? '周额度' : '小时额度');
}

function drawDeepSeekSummary(ctx, deepseek, todayCost, todayTokens) {
  drawText(ctx, 'DEEPSEEK', 28, 246, 15, 750);
  drawBox(ctx, 28, 268, 544, 116, PALETTE.paper, PALETTE.ink, 2);

  const topMetrics = [
    ['余额', formatMoney(deepseek.balance)],
    ['今日费用', formatMoney(todayCost)],
    ['今日 Token', formatTokens(todayTokens)]
  ];

  topMetrics.forEach(([label, value], index) => {
    const left = 28 + index * (544 / 3);
    const center = left + 544 / 6;
    drawText(ctx, label, center, 278, 13, 650, 'center', PALETTE.dark);
    drawText(ctx, value, center, 300, 24, 800, 'center');
    if (index < 2) drawLine(ctx, left + 544 / 3, 278, left + 544 / 3, 326, 2, PALETTE.dark);
  });

  drawLine(ctx, 28, 334, 572, 334, 2, PALETTE.dark);
  const range = deepSeekRangeMetrics(deepseek);
  const bottomMetrics = [
    ['筛选范围费用', formatMoney(range.rangeCost)],
    ['筛选范围 Token', formatTokens(range.rangeTokens)]
  ];
  bottomMetrics.forEach(([label, value], index) => {
    const left = 28 + index * 272;
    const center = left + 136;
    drawText(ctx, label, center, 342, 12, 650, 'center', PALETTE.dark);
    drawText(ctx, value, center, 359, 20, 800, 'center');
    if (index === 0) drawLine(ctx, 300, 342, 300, 376, 2, PALETTE.dark);
  });
}

function drawModel(ctx, x, title, model, gray = false) {
  const y = 396;
  drawBox(ctx, x, y, 264, 178, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, title, x + 14, y + 10, 15, 800);
  drawText(ctx, formatMoney(model.cost), x + 248, y + 10, 18, 800, 'right');
  drawText(ctx, formatTokens(model.tokens), x + 14, y + 38, 28, 850);
  drawText(ctx, '总 TOKEN', x + 14, y + 72, 11, 650, 'left', PALETTE.dark);
  drawLine(ctx, x + 14, y + 90, x + 250, y + 90, 2, PALETTE.dark);

  const parts = [
    ['未缓存', model.cacheMissTokens],
    ['已缓存', model.cacheHitTokens],
    ['输出', model.outputTokens]
  ];
  parts.forEach(([label, value], index) => {
    const center = x + 14 + (index + 0.5) * (236 / 3);
    drawText(ctx, label, center, y + 97, 10, 650, 'center', PALETTE.dark);
    drawText(ctx, formatTokens(value), center, y + 114, 14, 800, 'center');
  });

  drawText(ctx, '缓存率', x + 14, y + 141, 11, 650, 'left', PALETTE.dark);
  drawText(ctx, formatPercent(model.cacheRate), x + 250, y + 141, 11, 750, 'right', PALETTE.dark);
  drawBar(ctx, x + 14, y + 160, 236, 10, cacheRateToRatio(model.cacheRate), gray ? PALETTE.dark : PALETTE.ink);
}

function drawRangeFallback(ctx, deepseek) {
  const requests = numericValue(deepseek.range?.requests);
  const tokens = numericValue(deepseek.range?.tokens);
  const average = requests && tokens != null ? tokens / requests : null;

  drawBox(ctx, 28, 396, 264, 178, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, 'API 请求', 42, 416, 15, 800);
  drawText(ctx, formatInteger(requests), 42, 458, 34, 850);
  drawText(ctx, '当前筛选范围', 42, 520, 13, 600, 'left', PALETTE.dark);

  drawBox(ctx, 308, 396, 264, 178, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, '平均 Token / 请求', 322, 416, 15, 800);
  drawText(ctx, formatTokens(average), 322, 458, 34, 850);
  drawText(ctx, '总 Token ÷ 请求数', 322, 520, 13, 600, 'left', PALETTE.dark);
}

function drawCache(ctx, deepseek, flash, pro, dailyMode) {
  drawBox(ctx, 28, 586, 544, 70, PALETTE.paper, PALETTE.ink, 2);

  if (!dailyMode) {
    drawText(ctx, '今日 Flash / Pro 明细正在同步', 44, 601, 19, 800);
    drawText(ctx, '范围总览已显示', 556, 605, 13, 600, 'right', PALETTE.dark);
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
  drawBar(ctx, 44, 624, 512, 16, cacheRateToRatio(cacheRate));
}

function drawUnlockBand(ctx) {
  ctx.fillStyle = PALETTE.unlock;
  ctx.fillRect(0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockHeight);
  drawLine(ctx, 0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockTop, 2, PALETTE.ink);
}

function drawFooter(ctx, state) {
  drawLine(ctx, 28, 668, 572, 668, 2);
  drawText(ctx, `Codex ${formatTime(state.codex?.capturedAt)}`, 28, 682, 13, 650, 'left', PALETTE.dark);
  drawText(ctx, `DeepSeek ${formatTime(state.deepseek?.capturedAt)}`, 572, 682, 13, 650, 'right', PALETTE.dark);
  drawUnlockBand(ctx);
}

export function renderKindleDashboard(ctx, state) {
  ctx.fillStyle = PALETTE.white;
  ctx.fillRect(0, 0, KINDLE_LAYOUT.width, KINDLE_LAYOUT.height);

  drawHeader(ctx);
  drawCodex(ctx, state.codex);

  const deepseek = state.deepseek || {};
  const flash = modelMetrics(deepseek, 'flash');
  const pro = modelMetrics(deepseek, 'pro');
  const todayTokens = numericValue(deepseek.todayTokens) ?? ([flash.tokens, pro.tokens].some(value => value != null) ? (flash.tokens || 0) + (pro.tokens || 0) : null);
  const todayCost = numericValue(deepseek.todayCost) ?? ([flash.cost, pro.cost].some(value => value != null) ? (flash.cost || 0) + (pro.cost || 0) : null);
  const dailyMode = [todayTokens, todayCost, flash.tokens, pro.tokens, flash.cost, pro.cost].some(value => value != null);

  drawDeepSeekSummary(ctx, deepseek, todayCost, todayTokens);
  if (dailyMode) {
    drawModel(ctx, 28, 'V4 FLASH', flash, false);
    drawModel(ctx, 308, 'V4 PRO', pro, true);
  } else {
    drawRangeFallback(ctx, deepseek);
  }
  drawCache(ctx, deepseek, flash, pro, dailyMode);
  drawFooter(ctx, state);
}
