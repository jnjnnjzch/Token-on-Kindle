import { encodeGrayscalePng, rgbaToGrayscale, verifyKindlePng } from './core.mjs';

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
let state = { codex: null, deepseek: null, receivedAt: null };
const canvas = document.querySelector('#dashboard');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const fmt = value => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
};
const metric = item => item?.text || fmt(item?.value);

function box(x, y, w, h, line = 2) { ctx.lineWidth = line; ctx.strokeRect(x, y, w, h); }
function text(value, x, y, size = 16, bold = false, align = 'left') {
  ctx.font = `${bold ? 800 : 400} ${size}px system-ui,"Microsoft YaHei",sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(String(value), x, y);
}

function render() {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 800);
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
  text('AI 用量', 24, 18, 36, true);
  text(`更新 ${new Date().toLocaleString()}`, 576, 24, 13, false, 'right');
  ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(24, 72); ctx.lineTo(576, 72); ctx.stroke();

  text('Codex', 24, 88, 23, true);
  text('Web Analytics', 576, 94, 13, false, 'right');
  box(24, 122, 552, 145, 3);
  const quotas = state.codex?.quotas || [];
  const weekly = quotas.find(q => q.id === 'weekly') || quotas[0];
  if (weekly) {
    const remaining = Math.max(0, Math.min(100, Number(weekly.remainingPercent ?? weekly.displayedPercent ?? 0)));
    text('本周额度剩余', 40, 139, 18, true);
    text(`${remaining}%`, 559, 135, 49, true, 'right');
    box(40, 194, 520, 31, 3);
    ctx.fillRect(45, 199, Math.round(510 * remaining / 100), 21);
    text(`剩余 ${remaining}%`, 40, 231, 13);
    text(`已用 ${weekly.usedPercent ?? 100 - remaining}%`, 560, 231, 13, false, 'right');
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(40, 252); ctx.lineTo(560, 252); ctx.stroke();
    text(`重置：${weekly.resetText || '未知'}`, 40, 256, 14);
  } else {
    text('尚未采集，请打开 Codex Analytics', 40, 165, 18, true);
  }

  text('DeepSeek API', 24, 291, 23, true);
  text('Platform', 576, 297, 13, false, 'right');
  box(24, 326, 552, 71, 3);
  text('账户余额', 39, 339, 17, true);
  text('来自已登录的 Platform 页面', 39, 368, 12);
  text(metric(state.deepseek?.balance), 560, 342, 34, true, 'right');
  const cards = [
    [24, 408, '今日消耗', metric(state.deepseek?.todayCost), `${metric(state.deepseek?.todayTokens)} tokens`],
    [305, 408, '本月消耗', metric(state.deepseek?.monthCost), `${metric(state.deepseek?.monthTokens)} tokens`],
    [24, 522, '今日 Token', metric(state.deepseek?.todayTokens), '来自 Usage 页面'],
    [305, 522, '缓存命中率', metric(state.deepseek?.cacheRate), '未显示则为 —']
  ];
  for (const [x, y, title, value, sub] of cards) {
    box(x, y, 271, 104, 2);
    text(title, x + 13, y + 11, 15, true);
    text(value, x + 13, y + 38, 28, true);
    text(sub, x + 13, y + 80, 12);
  }
  box(24, 637, 552, 92, 2);
  text('采集状态', 36, 647, 15, true);
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(24, 675); ctx.lineTo(576, 675); ctx.stroke();
  text(`Codex：${state.codex?.capturedAt ? new Date(state.codex.capturedAt).toLocaleString() : '未连接'}`, 36, 686, 13);
  text(`DeepSeek：${state.deepseek?.capturedAt ? new Date(state.deepseek.capturedAt).toLocaleString() : '未连接'}`, 36, 712, 13);
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(24, 750); ctx.lineTo(576, 750); ctx.stroke();
  box(24, 764, 48, 24, 1);
  text('AUTO', 48, 769, 12, true, 'center');
  text('每 10 分钟采集', 82, 767, 12);
  text('离线保留最后画面', 576, 767, 12, false, 'right');
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
  publish().catch(error => { document.querySelector('#service').textContent = `生成失败：${error.message}`; });
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
  await listen('metrics-updated', event => { state = event.payload; updateUi(); });
}

document.querySelector('#open-codex').onclick = () => invoke?.('open_source', { source: 'codex' });
document.querySelector('#open-deepseek').onclick = () => invoke?.('open_source', { source: 'deepseek' });
document.querySelector('#refresh').onclick = () => publish();
document.querySelector('#copy').onclick = () => navigator.clipboard.writeText(document.querySelector('#url').textContent);
load();
