import { encodeGrayscalePng, rgbaToGrayscale, verifyKindlePng } from './core.mjs';
import { renderKindleDashboard } from './kindle-renderer.js';
import { DEFAULT_PROFILE_ID, KINDLE_PROFILES, getKindleProfile } from './profiles.js';

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
let state = { codex: null, deepseek: null, receivedAt: null };
const canvas = document.querySelector('#dashboard');
const previewCtx = canvas.getContext('2d', { willReadFrequently: true });
let selectedProfileId = localStorage.getItem('token-on-kindle:profile') || DEFAULT_PROFILE_ID;

function renderToContext(targetCtx, width, height) {
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.setTransform(width / 600, 0, 0, height / 800, 0, 0);
  renderKindleDashboard(targetCtx, state);
  targetCtx.restore();
}

function renderPreview() {
  renderToContext(previewCtx, 600, 800);
}

function updateProfileUi() {
  const profile = getKindleProfile(selectedProfileId);
  const format = document.querySelector('#format-note');
  const description = document.querySelector('#profile-description');
  if (format) format.textContent = `${profile.width} × ${profile.height} · 8 位灰度 PNG`;
  if (description) description.textContent = profile.models;
}

function initializeProfileSelect() {
  const select = document.querySelector('#kindle-profile');
  if (!select) return;
  select.replaceChildren(...KINDLE_PROFILES.map(profile => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.name} — ${profile.models}`;
    return option;
  }));
  selectedProfileId = getKindleProfile(selectedProfileId).id;
  select.value = selectedProfileId;
  select.addEventListener('change', () => {
    selectedProfileId = getKindleProfile(select.value).id;
    localStorage.setItem('token-on-kindle:profile', selectedProfileId);
    updateProfileUi();
    publish().catch(error => {
      document.querySelector('#service').textContent = `生成失败：${error.message}`;
    });
  });
  updateProfileUi();
}

async function publish() {
  renderPreview();
  const profile = getKindleProfile(selectedProfileId);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = profile.width;
  outputCanvas.height = profile.height;
  const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  renderToContext(outputCtx, profile.width, profile.height);

  const rgba = outputCtx.getImageData(0, 0, profile.width, profile.height).data;
  const png = encodeGrayscalePng(profile.width, profile.height, rgbaToGrayscale(rgba));
  const check = verifyKindlePng(png, profile.width, profile.height);
  if (!check.ok) throw new Error(check.error);
  if (invoke) {
    await invoke('set_dashboard_png', {
      bytes: Array.from(png),
      profile: profile.id
    });
  }
}

function updateUi() {
  document.querySelector('#codex-status').textContent = state.codex ? JSON.stringify(state.codex, null, 2) : '尚未采集';
  document.querySelector('#deepseek-status').textContent = state.deepseek ? JSON.stringify(state.deepseek, null, 2) : '尚未采集';
  publish().catch(error => {
    document.querySelector('#service').textContent = `生成失败：${error.message}`;
  });
}

async function load() {
  initializeProfileSelect();
  if (!invoke) {
    document.querySelector('#service').textContent = '浏览器预览模式';
    renderPreview();
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
