import { encodeGrayscalePng, rgbaToGrayscale, verifyKindlePng } from './core.mjs';
import { renderKindleDashboard } from './kindle-renderer.js';

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
let state = { codex: null, deepseek: null, receivedAt: null };
const canvas = document.querySelector('#dashboard');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function render() {
  renderKindleDashboard(ctx, state);
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
