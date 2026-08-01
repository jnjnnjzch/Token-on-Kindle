import { encodeGrayscalePng, rgbaToGrayscale, verifyKindlePng } from './core.mjs';

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const CODEX_URL = 'https://chatgpt.com/codex/cloud/settings/analytics';
const DEEPSEEK_URL = 'https://platform.deepseek.com/usage';
let state = { codex: null, deepseek: null, receivedAt: null };
const canvas = document.querySelector('#dashboard');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const valueOf = item => {
  if (item == null) return null;
  const value = typeof item === 'number' ? item : item.value;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};
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
  return n == null ? '—' : `${Math.max(0, Math.min(100, n)).toFixed(n % 1 ? 1 : 0)}%`;
};
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function box(x, y, w, h, line = 2) {
  ctx.lineWidth = line;
  ctx.strokeRect(x, y, w, h);
}
function line(x1, y1, x2, y2, width = 1) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function text(value, x, y, size = 16, bold = false, align = 'left') {
  ctx.font = `${bold ? 800 : 400} ${size}px system-ui,"Microsoft YaHei",sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(String(value), x, y);
}
function progressBar(x, y, w, h, ratio, outline = 2) {
  box(x, y, w, h, outline);
  const inner = Math.max(0, w - 8);
  ctx.fillRect(x + 4, y + 4, Math.round(inner * clamp(ratio)), Math.max(1, h - 8));
}
function sectionTitle(title, subtitle, y) {
  text(title, 28, y, 22, true);
  text(subtitle, 572, y + 5, 12, false, 'right');
}
function statColumn(label, value, x, y, align = 'left') {
  text(label, x, y, 12, false, align);
  text(value, x, y + 20, 25, true, align);
}

function deepSeekModel(data, name) {
  const raw = data?.[name] || {};
  return {
    tokens: valueOf(raw.tokens),
    cost: valueOf(raw.cost),
    cacheHitTokens: valueOf(raw.cacheHitTokens),
    cacheMissTokens: valueOf(raw.cacheMissTokens)
  };
}

function drawModelRow(y, label, model, tokenScale) {
  box(28, y, 544, 73, 2);
  text(label, 42, y + 10, 18, true);
  text(fmtTokens(model.tokens), 42, y + 34, 25, true);
  text('tokens', 143, y + 43, 11);
  text(fmtMoney(model.cost), 555, y + 13, 22, true, 'right');
  text('今日费用', 555, y + 41, 11, false, 'right');
  const ratio = model.tokens == null || tokenScale <= 0 ? 0 : model.tokens / tokenScale;
  progressBar(205, y + 43, 230, 16, ratio, 1);
}

function render() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 600, 800);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';

  text('AI 用量', 28, 17, 34, true);
  text(`更新 ${new Date().toLocaleString()}`, 572, 25, 11, false, 'right');
  line(28, 69, 572, 69, 4);

  sectionTitle('Codex', 'Web Analytics', 84);
  box(28, 116, 544, 132, 2);
  const quotas = state.codex?.quotas || [];
  const weekly = quotas.find(q => q.id === 'weekly') || quotas[0];
  if (weekly) {
    const remaining = clamp(Number(weekly.remainingPercent ?? weekly.displayedPercent ?? 0), 0, 100);
    text('本周额度剩余', 42, 132, 15, true);
    text(`${Math.round(remaining)}%`, 555, 124, 42, true, 'right');
    progressBar(42, 177, 516, 27, remaining / 100, 2);
    text(`剩余 ${Math.round(remaining)}%`, 42, 211, 11);
    text(`已用 ${Math.round(weekly.usedPercent ?? 100 - remaining)}%`, 558, 211, 11, false, 'right');
    line(42, 229, 558, 229, 1);
    text(`重置：${weekly.resetText || '未知'}`, 42, 232, 11);
  } else {
    text('尚未采集', 42, 151, 23, true);
    text('打开 Codex Analytics 后点击“同步到 Kindle”', 42, 189, 12);
  }

  const ds = state.deepseek || {};
  const flash = deepSeekModel(ds, 'flash');
  const pro = deepSeekModel(ds, 'pro');
  const todayTokens = valueOf(ds.todayTokens) ?? ((flash.tokens || 0) + (pro.tokens || 0) || null);
  const todayCost = valueOf(ds.todayCost) ?? ((flash.cost || 0) + (pro.cost || 0) || null);
  const cacheRate = valueOf(ds.cacheRate);
  const tokenScale = Math.max(flash.tokens || 0, pro.tokens || 0, 1);

  sectionTitle('DeepSeek API', '今日用量', 270);
  box(28, 302, 544, 74, 2);
  statColumn('账户余额', fmtMoney(ds.balance), 42, 314);
  statColumn('今日费用', fmtMoney(todayCost), 300, 314, 'center');
  statColumn('今日 Token', fmtTokens(todayTokens), 558, 314, 'right');
  line(200, 312, 200, 366, 1);
  line(400, 312, 400, 366, 1);

  drawModelRow(390, 'V4 Flash', flash, tokenScale);
  drawModelRow(474, 'V4 Pro', pro, tokenScale);

  box(28, 558, 544, 82, 2);
  text('缓存命中率', 42, 571, 16, true);
  text(fmtPercent(cacheRate), 558, 566, 30, true, 'right');
  progressBar(42, 607, 516, 22, cacheRate == null ? 0 : cacheRate / 100, 2);

  box(28, 655, 544, 69, 1);
  text('采集状态', 42, 666, 13, true);
  const codexTime = state.codex?.capturedAt ? new Date(state.codex.capturedAt).toLocaleTimeString() : '未连接';
  const deepseekTime = ds.capturedAt ? new Date(ds.capturedAt).toLocaleTimeString() : '未连接';
  text(`Codex ${codexTime}`, 42, 692, 11);
  text(`DeepSeek ${deepseekTime}`, 558, 692, 11, false, 'right');

  line(28, 744, 572, 744, 3);
  box(28, 760, 48, 21, 1);
  text('AUTO', 52, 764, 11, true, 'center');
  text('每 10 分钟同步', 86, 763, 11);
  text('600×800 · 8 位灰度 PNG', 572, 763, 11, false, 'right');
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
  document.querySelector('#service').textContent = '后台服务已运行';
  updateUi();
  await listen('metrics-updated', event => {
    state = event.payload;
    updateUi();
  });
}

function openInCurrentWebview(url) {
  document.querySelector('#service').textContent = '正在打开登录页…';
  window.location.assign(url);
}

document.querySelector('#open-codex').onclick = () => openInCurrentWebview(CODEX_URL);
document.querySelector('#open-deepseek').onclick = () => openInCurrentWebview(DEEPSEEK_URL);
document.querySelector('#refresh').onclick = () => publish();
document.querySelector('#copy').onclick = () => navigator.clipboard.writeText(document.querySelector('#url').textContent);
load();
