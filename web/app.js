import { encodeGrayscalePng, rgbaToGrayscale, verifyKindlePng } from './core.mjs';
import { diagnosticSnapshot } from './diagnostics.js';
import { renderKindleDashboard } from './kindle-renderer.js';
import { DEFAULT_PROFILE_ID, KINDLE_PROFILES, getKindleProfile } from './profiles.js';

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const REFRESH_STORAGE_KEY = 'token-on-kindle:refresh-minutes';
const DEFAULT_REFRESH_MINUTES = 10;
const MIN_REFRESH_MINUTES = 1;
const MAX_REFRESH_MINUTES = 1440;

let state = { codex: null, deepseek: null, receivedAt: null, refreshMinutes: DEFAULT_REFRESH_MINUTES };
const canvas = document.querySelector('#dashboard');
const previewCtx = canvas.getContext('2d', { willReadFrequently: true });
let selectedProfileId = localStorage.getItem('token-on-kindle:profile') || DEFAULT_PROFILE_ID;

const numeric = value => {
  const raw = typeof value === 'object' && value !== null ? value.value : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

function normalizeRefreshMinutes(value) {
  if (value == null || value === '') return DEFAULT_REFRESH_MINUTES;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_REFRESH_MINUTES;
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, parsed));
}

function refreshDescription(minutes) {
  if (minutes < 60) return `每 ${minutes} 分钟刷新`;
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时刷新`;
  return `每 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟刷新`;
}

function serviceDescription(prefix = '后台采集正常') {
  return `${prefix} · ${refreshDescription(state.refreshMinutes)}`;
}

function formatSyncTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '刚刚收到数据';
  return `同步于 ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function hasUsefulData(source, payload) {
  if (!payload) return false;
  if (source === 'codex') return Array.isArray(payload.quotas) && payload.quotas.length > 0;
  return [
    numeric(payload.balance), numeric(payload.todayCost), numeric(payload.todayTokens),
    numeric(payload.account?.cumulativeCost), numeric(payload.models?.flash?.tokens),
    numeric(payload.models?.pro?.tokens)
  ].some(value => value != null);
}

function updateSourceCard(source, payload) {
  const card = document.querySelector(`#open-${source}`);
  const status = document.querySelector(`#${source}-connection`);
  const detail = document.querySelector(`#${source}-detail`);
  if (!card || !status || !detail) return;
  if (!payload) {
    card.dataset.state = 'idle';
    status.textContent = '需要登录';
    detail.textContent = '点击打开登录页面';
  } else if (!hasUsefulData(source, payload)) {
    card.dataset.state = 'error';
    status.textContent = '同步失败';
    detail.textContent = payload.diagnostics?.directError || '没有读取到有效数据';
  } else {
    card.dataset.state = 'connected';
    status.textContent = '已连接';
    detail.textContent = formatSyncTime(payload.capturedAt);
  }
}

function renderToContext(targetCtx, width, height) {
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.setTransform(width / 600, 0, 0, height / 800, 0, 0);
  renderKindleDashboard(targetCtx, state);
  targetCtx.restore();
}

function renderPreview() { renderToContext(previewCtx, 600, 800); }

function updateProfileUi() {
  const profile = getKindleProfile(selectedProfileId);
  document.querySelector('#format-note').textContent = `${profile.width} × ${profile.height} · 8 位灰度 PNG`;
  document.querySelector('#profile-description').textContent = profile.models;
}

function initializeProfileSelect() {
  const select = document.querySelector('#kindle-profile');
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
    publish().catch(error => { document.querySelector('#service').textContent = `生成失败：${error.message}`; });
  });
  updateProfileUi();
}

function updateRefreshUi() {
  document.querySelector('#refresh-minutes').value = String(state.refreshMinutes);
  document.querySelector('#refresh-value').textContent = refreshDescription(state.refreshMinutes);
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
  if (invoke) await invoke('set_dashboard_png', { bytes: Array.from(png), profile: profile.id });
}

function updateUi() {
  updateSourceCard('codex', state.codex);
  updateSourceCard('deepseek', state.deepseek);
  const codexDiagnostic = diagnosticSnapshot('codex', state.codex);
  const deepseekDiagnostic = diagnosticSnapshot('deepseek', state.deepseek);
  document.querySelector('#codex-status').textContent = codexDiagnostic ? JSON.stringify(codexDiagnostic, null, 2) : '尚未采集';
  document.querySelector('#deepseek-status').textContent = deepseekDiagnostic ? JSON.stringify(deepseekDiagnostic, null, 2) : '尚未采集';
  updateRefreshUi();
  publish().catch(error => { document.querySelector('#service').textContent = `生成失败：${error.message}`; });
}

async function applySavedRefreshInterval() {
  const saved = normalizeRefreshMinutes(localStorage.getItem(REFRESH_STORAGE_KEY));
  const settings = await invoke('set_refresh_interval', { minutes: saved });
  state.refreshMinutes = normalizeRefreshMinutes(settings.refreshMinutes);
  localStorage.setItem(REFRESH_STORAGE_KEY, String(state.refreshMinutes));
  document.querySelector('#url').textContent = settings.imageUrl;
  document.querySelector('#browser-url').textContent = settings.browserUrl;
}

async function load() {
  initializeProfileSelect();
  if (!invoke) {
    document.querySelector('#service').textContent = '浏览器预览模式';
    updateUi();
    return;
  }
  await applySavedRefreshInterval();
  const metrics = await invoke('get_status');
  state = { ...metrics, refreshMinutes: state.refreshMinutes };
  document.querySelector('#service').textContent = serviceDescription();
  updateUi();
  await listen('metrics-updated', event => {
    state = { ...event.payload, refreshMinutes: state.refreshMinutes };
    document.querySelector('#service').textContent = serviceDescription('已收到最新数据');
    updateUi();
  });
}

async function openSource(source) {
  document.querySelector('#service').textContent = `正在打开 ${source === 'codex' ? 'Codex' : 'DeepSeek'}…`;
  try {
    await invoke?.('open_source', { source });
    document.querySelector('#service').textContent = serviceDescription();
  } catch (error) { document.querySelector('#service').textContent = `打开失败：${error}`; }
}

async function refreshNow() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  document.querySelector('#service').textContent = '正在刷新两个数据源…';
  try {
    await invoke?.('refresh_sources');
    setTimeout(() => {
      document.querySelector('#service').textContent = serviceDescription('已触发刷新，等待页面返回');
      button.disabled = false;
    }, 700);
  } catch (error) {
    button.disabled = false;
    document.querySelector('#service').textContent = `刷新失败：${error}`;
  }
}

async function saveRefreshInterval() {
  const input = document.querySelector('#refresh-minutes');
  const minutes = normalizeRefreshMinutes(input.value);
  input.value = String(minutes);
  try {
    const settings = await invoke('set_refresh_interval', { minutes });
    state.refreshMinutes = normalizeRefreshMinutes(settings.refreshMinutes);
    localStorage.setItem(REFRESH_STORAGE_KEY, String(state.refreshMinutes));
    document.querySelector('#url').textContent = settings.imageUrl;
    document.querySelector('#browser-url').textContent = settings.browserUrl;
    updateRefreshUi();
    await publish();
    document.querySelector('#service').textContent = serviceDescription('刷新间隔已保存');
  } catch (error) { document.querySelector('#service').textContent = `保存失败：${error}`; }
}

async function copyText(selector, button, successText) {
  try {
    await navigator.clipboard.writeText(document.querySelector(selector).textContent);
    const previous = button.textContent;
    button.textContent = successText;
    setTimeout(() => { button.textContent = previous; }, 1200);
  } catch { document.querySelector('#service').textContent = '复制失败，请手动选择地址'; }
}

document.querySelector('#open-codex').onclick = () => openSource('codex');
document.querySelector('#open-deepseek').onclick = () => openSource('deepseek');
document.querySelector('#refresh').onclick = refreshNow;
document.querySelector('#save-refresh').onclick = saveRefreshInterval;
document.querySelector('#refresh-minutes').addEventListener('keydown', event => { if (event.key === 'Enter') saveRefreshInterval(); });
document.querySelector('#copy').onclick = event => copyText('#url', event.currentTarget, '已复制');
document.querySelector('#copy-browser').onclick = event => copyText('#browser-url', event.currentTarget, '已复制');
load().catch(error => { document.querySelector('#service').textContent = `启动失败：${error}`; });
