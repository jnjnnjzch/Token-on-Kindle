const PALETTE = {
  white: '#ffffff',
  ink: '#000000',
  dark: '#3f3f3f',
  light: '#d2d2d2',
  paper: '#f2f2f2'
};

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

function drawHeader(ctx) {
  drawText(ctx, 'AI 用量', 28, 18, 34, 800);
  drawText(ctx, 'Codex · DeepSeek', 572, 30, 14, 650, 'right', PALETTE.dark);
  drawLine(ctx, 28, 68, 572, 68, 3);
}

function drawCodex(ctx, codex) {
  drawText(ctx, 'CODEX 周额度', 28, 84, 15, 750);
  const quota = (codex?.quotas || []).find(item => item.id === 'weekly') || codex?.quotas?.[0];
  drawBox(ctx, 28, 108, 544, 118, PALETTE.white, PALETTE.ink, 2);

  if (!quota) {
    drawText(ctx, '尚未同步', 46, 132, 30, 800);
    drawText(ctx, '打开 Codex Analytics 完成登录', 46, 178, 15, 550, 'left', PALETTE.dark);
    return;
  }

  const remaining = clamp(Number(quota.remainingPercent ?? quota.displayedPercent ?? 0), 0, 100);
  drawText(ctx, `${Math.round(remaining)}%`, 554, 124, 48, 850, 'right');
  drawText(ctx, '剩余', 46, 134, 18, 700);
  drawBar(ctx, 46, 184, 508, 20, remaining / 100);
  drawText(ctx, `已用 ${Math.round(quota.usedPercent ?? 100 - remaining)}%`, 46, 208, 13, 600, 'left', PALETTE.dark);
  drawText(ctx, quota.resetText ? `重置 ${quota.resetText}` : '重置时间未知', 554, 208, 13, 600, 'right', PALETTE.dark);
}

function drawDeepSeekSummary(ctx, deepseek, dailyMode, cost, tokens) {
  drawText(ctx, dailyMode ? 'DEEPSEEK 今日' : 'DEEPSEEK 当前筛选范围', 28, 244, 15, 750);
  drawBox(ctx, 28, 268, 544, 86, PALETTE.paper, PALETTE.ink, 2);

  const metrics = [
    ['余额', formatMoney(deepseek.balance)],
    [dailyMode ? '今日费用' : '范围费用', formatMoney(cost)],
    [dailyMode ? '今日 Token' : '范围 Token', formatTokens(tokens)]
  ];

  metrics.forEach(([label, value], index) => {
    const left = 28 + index * (544 / 3);
    const center = left + 544 / 6;
    drawText(ctx, label, center, 281, 14, 650, 'center', PALETTE.dark);
    drawText(ctx, value, center, 310, 25, 800, 'center');
    if (index < 2) drawLine(ctx, left + 544 / 3, 278, left + 544 / 3, 344, 2, PALETTE.dark);
  });
}

function drawModel(ctx, x, title, model, gray = false) {
  const y = 368;
  drawBox(ctx, x, y, 264, 174, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, title, x + 14, y + 12, 15, 800);
  drawText(ctx, formatMoney(model.cost), x + 248, y + 12, 18, 800, 'right');
  drawText(ctx, formatTokens(model.tokens), x + 14, y + 42, 28, 850);
  drawText(ctx, '总 TOKEN', x + 14, y + 76, 11, 650, 'left', PALETTE.dark);
  drawLine(ctx, x + 14, y + 94, x + 250, y + 94, 2, PALETTE.dark);

  const parts = [
    ['未缓存', model.cacheMissTokens],
    ['已缓存', model.cacheHitTokens],
    ['输出', model.outputTokens]
  ];
  parts.forEach(([label, value], index) => {
    const center = x + 14 + (index + 0.5) * (236 / 3);
    drawText(ctx, label, center, y + 100, 10, 650, 'center', PALETTE.dark);
    drawText(ctx, formatTokens(value), center, y + 116, 14, 800, 'center');
  });

  drawText(ctx, '缓存率', x + 14, y + 139, 11, 650, 'left', PALETTE.dark);
  drawText(ctx, formatPercent(model.cacheRate), x + 250, y + 139, 11, 750, 'right', PALETTE.dark);
  drawBar(ctx, x + 14, y + 157, 236, 10, cacheRateToRatio(model.cacheRate), gray ? PALETTE.dark : PALETTE.ink);
}

function drawRangeFallback(ctx, deepseek) {
  const requests = numericValue(deepseek.range?.requests);
  const tokens = numericValue(deepseek.range?.tokens);
  const average = requests && tokens != null ? tokens / requests : null;

  drawBox(ctx, 28, 368, 264, 174, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, 'API 请求', 42, 386, 15, 800);
  drawText(ctx, formatInteger(requests), 42, 426, 32, 850);
  drawText(ctx, '当前筛选范围', 42, 480, 13, 600, 'left', PALETTE.dark);

  drawBox(ctx, 308, 368, 264, 174, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, '平均 Token / 请求', 322, 386, 15, 800);
  drawText(ctx, formatTokens(average), 322, 426, 32, 850);
  drawText(ctx, '总 Token ÷ 请求数', 322, 480, 13, 600, 'left', PALETTE.dark);
}

function drawCache(ctx, deepseek, flash, pro, dailyMode) {
  drawBox(ctx, 28, 554, 544, 70, PALETTE.paper, PALETTE.ink, 2);

  if (!dailyMode) {
    drawText(ctx, '今日 Flash / Pro 明细正在同步', 44, 569, 19, 800);
    drawText(ctx, '范围总览已显示', 556, 572, 13, 600, 'right', PALETTE.dark);
    return;
  }

  let cacheRate = numericValue(deepseek.cacheRate);
  if (cacheRate == null) {
    const hit = (flash.cacheHitTokens || 0) + (pro.cacheHitTokens || 0);
    const miss = (flash.cacheMissTokens || 0) + (pro.cacheMissTokens || 0);
    cacheRate = hit + miss > 0 ? hit / (hit + miss) * 100 : null;
  }
  drawText(ctx, '总体缓存命中率', 44, 566, 15, 750);
  drawText(ctx, formatPercent(cacheRate), 556, 562, 25, 850, 'right');
  drawBar(ctx, 44, 601, 512, 14, cacheRateToRatio(cacheRate));
}

function drawUnlockDock(ctx) {
  const x = 104;
  const y = 722;
  const width = 392;
  const height = 78;
  const radius = 18;

  drawLine(ctx, 28, 714, 572, 714, 3, PALETTE.ink);
  drawLine(ctx, 28, 742, x - 16, 742, 2, PALETTE.dark);
  drawLine(ctx, x + width + 16, 742, 572, 742, 2, PALETTE.dark);

  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.moveTo(x, 800);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, 800);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PALETTE.dark;
  ctx.fillRect(266, y + 10, 68, 4);
}

function drawFooter(ctx, state) {
  drawLine(ctx, 28, 638, 572, 638, 2);
  drawText(ctx, `Codex ${formatTime(state.codex?.capturedAt)}`, 28, 651, 13, 650, 'left', PALETTE.dark);
  drawText(ctx, `DeepSeek ${formatTime(state.deepseek?.capturedAt)}`, 572, 651, 13, 650, 'right', PALETTE.dark);
  drawText(ctx, '每 10 分钟自动更新', 300, 682, 13, 650, 'center', PALETTE.dark);
  drawUnlockDock(ctx);
}

export function renderKindleDashboard(ctx, state) {
  ctx.fillStyle = PALETTE.white;
  ctx.fillRect(0, 0, 600, 800);

  drawHeader(ctx);
  drawCodex(ctx, state.codex);

  const deepseek = state.deepseek || {};
  const flash = modelMetrics(deepseek, 'flash');
  const pro = modelMetrics(deepseek, 'pro');
  const todayTokens = numericValue(deepseek.todayTokens) ?? ([flash.tokens, pro.tokens].some(value => value != null) ? (flash.tokens || 0) + (pro.tokens || 0) : null);
  const todayCost = numericValue(deepseek.todayCost) ?? ([flash.cost, pro.cost].some(value => value != null) ? (flash.cost || 0) + (pro.cost || 0) : null);
  const dailyMode = [todayTokens, todayCost, flash.tokens, pro.tokens, flash.cost, pro.cost].some(value => value != null);
  const shownCost = dailyMode ? todayCost : numericValue(deepseek.range?.cost);
  const shownTokens = dailyMode ? todayTokens : numericValue(deepseek.range?.tokens);

  drawDeepSeekSummary(ctx, deepseek, dailyMode, shownCost, shownTokens);
  if (dailyMode) {
    drawModel(ctx, 28, 'V4 FLASH', flash, false);
    drawModel(ctx, 308, 'V4 PRO', pro, true);
  } else {
    drawRangeFallback(ctx, deepseek);
  }
  drawCache(ctx, deepseek, flash, pro, dailyMode);
  drawFooter(ctx, state);
}
