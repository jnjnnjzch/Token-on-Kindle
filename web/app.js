import { encodeGrayscalePng, rgbaToGrayscale, verifyKindlePng } from './core.mjs';

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
let state = { codex: null, deepseek: null, receivedAt: null };
const canvas = document.querySelector('#dashboard');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const palette = {
  paper: '#ffffff',
  ink: '#111111',
  secondary: '#5f5f5f',
  soft: '#ededeb',
  softer: '#f6f6f3',
  mid: '#9a9a96',
  line: '#c8c8c3',
  black: '#000000'
};

const valueOf = item => {
  if (item == null) return null;
  const value = typeof item === 'number' ? item : item.value;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const fmtTokens = value => {
  const n = valueOf(value);
  if (n == null) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString();
};
const fmtMoney = value => {
  const n = valueOf(value);
  return n == null ? '—' : `¥${n.toFixed(2)}`;
};
const fmtPercent = value => {
  const n = valueOf(value);
  if (n == null) return '—';
  const bounded = clamp(n, 0, 100);
  return `${bounded.toFixed(Math.abs(bounded % 1) > 0.05 ? 1 : 0)}%`;
};
const timeOnly = value => {
  if (!value) return '未连接';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function setFill(value) { ctx.fillStyle = value; }
function setStroke(value) { ctx.strokeStyle = value; }
function roundedPath(x, y, w, h, r = 12) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
function card(x, y, w, h, { fill = palette.softer, stroke = null, radius = 12, lineWidth = 1 } = {}) {
  roundedPath(x, y, w, h, radius);
  if (fill) {
    setFill(fill);
    ctx.fill();
  }
  if (stroke) {
    setStroke(stroke);
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}
function line(x1, y1, x2, y2, width = 1, color = palette.ink) {
  setStroke(color);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function text(value, x, y, size = 16, weight = 400, align = 'left', color = palette.ink) {
  setFill(color);
  ctx.font = `${weight} ${size}px system-ui,"Microsoft YaHei",sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(String(value), x, y);
}
function label(value, x, y, align = 'left') {
  text(value, x, y, 11, 650, align, palette.secondary);
}
function horizontalBar(x, y, w, h, ratio, fill = palette.ink) {
  card(x, y, w, h, { fill: palette.line, radius: h / 2 });
  const width = Math.max(0, Math.round(w * clamp(ratio)));
  if (width > 0) card(x, y, width, h, { fill, radius: h / 2 });
}

function modelData(ds, name) {
  const raw = ds?.models?.[name] || ds?.[name] || {};
  const hit = valueOf(raw.cacheHitTokens);
  const miss = valueOf(raw.cacheMissTokens);
  return {
    tokens: valueOf(raw.tokens),
    cost: valueOf(raw.cost),
    cacheRate: valueOf(raw.cacheRate) ?? (hit != null || miss != null ? 100 * (hit || 0) / Math.max(1, (hit || 0) + (miss || 0)) : null)
  };
}

function drawCodex(weekly) {
  label('CODEX · WEEKLY', 34, 83);
  card(28, 102, 544, 132, { fill: palette.softer, stroke: palette.line, radius: 16 });
  if (!weekly) {
    text('尚未同步', 46, 128, 26, 750);
    text('打开 Codex Analytics 完成登录', 46, 168, 13, 400, 'left', palette.secondary);
    return;
  }

  const remaining = clamp(Number(weekly.remainingPercent ?? weekly.displayedPercent ?? 0), 0, 100);
  text('本周剩余', 46, 124, 15, 650, 'left', palette.secondary);
  text(`${Math.round(remaining)}%`, 554, 115, 46, 800, 'right');
  horizontalBar(46, 174, 508, 18, remaining / 100, palette.black);
  text(`已用 ${Math.round(weekly.usedPercent ?? 100 - remaining)}%`, 46, 202, 11, 500, 'left', palette.secondary);
  text(weekly.resetText ? `重置 ${weekly.resetText}` : '重置时间未知', 554, 202, 11, 500, 'right', palette.secondary);
}

function drawSummary(ds, todayCost, todayTokens) {
  label('DEEPSEEK · TODAY', 34, 252);
  text(ds.date || '今日', 566, 250, 11, 500, 'right', palette.secondary);
  card(28, 270, 544, 74, { fill: palette.softer, stroke: palette.line, radius: 14 });

  const metrics = [
    ['余额', fmtMoney(ds.balance)],
    ['今日费用', fmtMoney(todayCost)],
    ['今日 Token', fmtTokens(todayTokens)]
  ];
  metrics.forEach(([name, value], index) => {
    const center = 28 + (index + 0.5) * (544 / 3);
    label(name, center, 284, 'center');
    text(value, center, 305, 23, 760, 'center');
    if (index < 2) line(28 + (index + 1) * (544 / 3), 282, 28 + (index + 1) * (544 / 3), 332, 1, palette.line);
  });
}

function drawModelCard(x, y, title, model, tokenMax, fill) {
  card(x, y, 264, 112, { fill: palette.softer, stroke: palette.line, radius: 14 });
  label(title, x + 16, y + 14);
  text(fmtTokens(model.tokens), x + 16, y + 35, 27, 780);
  text('tokens', x + 16, y + 69, 10, 500, 'left', palette.secondary);
  text(fmtMoney(model.cost), x + 248, y + 15, 17, 700, 'right');
  text(model.cacheRate == null ? '缓存率 —' : `缓存率 ${fmtPercent(model.cacheRate)}`, x + 248, y + 43, 10, 500, 'right', palette.secondary);
  horizontalBar(x + 16, y + 88, 232, 8, model.tokens == null ? 0 : model.tokens / tokenMax, fill);
}

function verticalBar(x, baseline, width, height, fill) {
  card(x, baseline - height, width, height, { fill, radius: Math.min(6, width / 4) });
}

function drawComposition(flash, pro) {
  card(28, 486, 544, 128, { fill: palette.softer, stroke: palette.line, radius: 14 });
  label('今日构成', 44, 500);
  text('Flash 与 Pro', 556, 500, 10, 500, 'right', palette.secondary);

  const groups = [
    { x: 52, title: 'TOKEN', flash: flash.tokens, pro: pro.tokens, formatter: fmtTokens },
    { x: 316, title: '费用', flash: flash.cost, pro: pro.cost, formatter: fmtMoney }
  ];

  for (const group of groups) {
    label(group.title, group.x, 526);
    const max = Math.max(group.flash || 0, group.pro || 0, 1);
    const baseline = 589;
    line(group.x, baseline, group.x + 210, baseline, 1, palette.mid);
    const flashHeight = group.flash == null ? 0 : Math.max(3, 47 * group.flash / max);
    const proHeight = group.pro == null ? 0 : Math.max(3, 47 * group.pro / max);
    verticalBar(group.x + 38, baseline, 36, flashHeight, palette.black);
    verticalBar(group.x + 128, baseline, 36, proHeight, palette.mid);
    text(group.formatter(group.flash), group.x + 56, baseline - flashHeight - 15, 9, 600, 'center', palette.secondary);
    text(group.formatter(group.pro), group.x + 146, baseline - proHeight - 15, 9, 600, 'center', palette.secondary);
    text('F', group.x + 56, 593, 10, 700, 'center');
    text('P', group.x + 146, 593, 10, 700, 'center');
  }
  line(298, 520, 298, 600, 1, palette.line);
}

function drawCache(cacheRate, ds) {
  card(28, 628, 544, 62, { fill: palette.softer, stroke: palette.line, radius: 14 });
  label('CACHE HIT', 44, 640);
  text(fmtPercent(cacheRate), 556, 635, 24, 760, 'right');
  horizontalBar(44, 669, 512, 8, cacheRate == null ? 0 : cacheRate / 100, palette.black);

  const codexTime = timeOnly(state.codex?.capturedAt);
  const deepseekTime = timeOnly(ds.capturedAt);
  text(`Codex ${codexTime}  ·  DeepSeek ${deepseekTime}`, 300, 699, 10, 500, 'center', palette.secondary);
}

function render() {
  setFill(palette.paper);
  ctx.fillRect(0, 0, 600, 800);

  text('AI 用量', 28, 20, 32, 800);
  text('TOKEN ON KINDLE', 30, 55, 10, 650, 'left', palette.secondary);
  text(new Date().toLocaleString(), 572, 28, 10, 500, 'right', palette.secondary);
  line(28, 72, 572, 72, 2, palette.ink);

  const quotas = state.codex?.quotas || [];
  const weekly = quotas.find(item => item.id === 'weekly') || quotas[0];
  drawCodex(weekly);

  const ds = state.deepseek || {};
  const flash = modelData(ds, 'flash');
  const pro = modelData(ds, 'pro');
  const todayTokens = valueOf(ds.todayTokens) ?? ([flash.tokens, pro.tokens].some(value => value != null) ? (flash.tokens || 0) + (pro.tokens || 0) : null);
  const todayCost = valueOf(ds.todayCost) ?? ([flash.cost, pro.cost].some(value => value != null) ? (flash.cost || 0) + (pro.cost || 0) : null);
  const cacheRate = valueOf(ds.cacheRate) ?? ([flash.cacheRate, pro.cacheRate].filter(value => value != null).length ? ((flash.cacheRate || 0) + (pro.cacheRate || 0)) / [flash.cacheRate, pro.cacheRate].filter(value => value != null).length : null);

  drawSummary(ds, todayCost, todayTokens);
  const tokenMax = Math.max(flash.tokens || 0, pro.tokens || 0, 1);
  drawModelCard(28, 358, 'V4 FLASH', flash, tokenMax, palette.black);
  drawModelCard(308, 358, 'V4 PRO', pro, tokenMax, palette.mid);
  drawComposition(flash, pro);
  drawCache(cacheRate, ds);

  // Kindle 在屏保底部叠加白色“滑动以解锁”。这里故意保留纯黑安全区，
  // 不放任何应用文字，使系统白字在各种固件上都保持清晰。
  setFill(palette.black);
  ctx.fillRect(0, 720, 600, 80);
}

async function publish() {
  render();
  const rgba = ctx.getImageData(0, 0, 600, 800).data;
  const png = encodeGrayscalePng(600, 800, rgbaToGrayscale(rgba));
  const check = verifyKindlePng(png);
  if (!check.ok) throw new Error(check.error);
  if (invoke) await invoke('set_dashboard_png', { bytes: Array.from(png) });
}

function updateUi() {
  document.querySelector('#codex-status').textContent = state.codex ? JSON.stringify(state.codex, null, 2) : '尚未采集';
  document.querySelector('#deepseek-status').textContent = state.deepseek ? JSON.stringify(state.deepseek, null, 2) : '尚未采集';
  publish().catch(error => {
    document.querySelector('#service').textContent = `生成失败：${error.message}`;
  });
}

async function load() {
  if (!invoke) {
    document.querySelector('#service').textContent = '浏览器预览模式';
    render();
    return;
  }
  state = await invoke('get_status');
  const url = await invoke('get_dashboard_url');
  document.querySelector('#url').textContent = url;
  document.querySelector('#service').textContent = '后台采集已启动 · 每 10 分钟更新';
  updateUi();
  await listen('metrics-updated', event => {
    state = event.payload;
    updateUi();
  });
}

async function openSource(source) {
  document.querySelector('#service').textContent = `正在打开 ${source === 'codex' ? 'Codex' : 'DeepSeek'}…`;
  try {
    await invoke?.('open_source', { source });
    document.querySelector('#service').textContent = '后台采集已启动 · 每 10 分钟更新';
  } catch (error) {
    document.querySelector('#service').textContent = `打开失败：${error}`;
  }
}

async function refreshNow() {
  document.querySelector('#service').textContent = '正在刷新两个用量页面…';
  try {
    await invoke?.('refresh_sources');
    setTimeout(() => {
      document.querySelector('#service').textContent = '已触发刷新，等待页面返回数据';
    }, 500);
  } catch (error) {
    document.querySelector('#service').textContent = `刷新失败：${error}`;
  }
}

document.querySelector('#open-codex').onclick = () => openSource('codex');
document.querySelector('#open-deepseek').onclick = () => openSource('deepseek');
document.querySelector('#refresh').onclick = refreshNow;
document.querySelector('#copy').onclick = () => navigator.clipboard.writeText(document.querySelector('#url').textContent);
load();
