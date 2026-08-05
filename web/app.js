import { encodeGrayscalePng, rgbaToGrayscale, verifyKindlePng } from './core.mjs';
import { diagnosticSnapshot } from './diagnostics.js';
import { renderKindleDashboard } from './kindle-renderer.js';
import { DEFAULT_PROFILE_ID, KINDLE_PROFILES, getKindleProfile } from './profiles.js';

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const REFRESH_STORAGE_KEY = 'token-on-kindle:refresh-minutes';
const DISPLAY_STORAGE_KEY = 'token-on-kindle:display-sources-v2';
const DEFAULT_REFRESH_MINUTES = 10;
const MIN_REFRESH_MINUTES = 1;
const MAX_REFRESH_MINUTES = 1440;
const PUBLISH_DEBOUNCE_MS = 350;
const SOURCES = Object.freeze([
  { id: 'codex', name: 'Codex' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'volcengine', name: '火山方舟' }
]);

let state = {
  codex: null,
  deepseek: null,
  volcengine: null,
  receivedAt: null,
  refreshMinutes: DEFAULT_REFRESH_MINUTES
};
let displaySources = loadDisplaySources();
const canvas = document.querySelector('#dashboard');
const previewCtx = canvas.getContext('2d', { willReadFrequently: true });
let selectedProfileId = localStorage.getItem('token-on-kindle:profile') || DEFAULT_PROFILE_ID;
let publishTimer = null;
let publishInFlight = null;
let publishQueued = false;
let refreshInFlight = false;
let pngWorker = null;
let pngWorkerFailed = false;
let pngWorkerRequestId = 0;
const pngWorkerRequests = new Map();

const numeric = value => {
  const raw = typeof value === 'object' && value !== null ? value.value : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

function loadDisplaySources() {
  const defaults = { codex: true, deepseek: true, volcengine: true };
  try {
    const saved = JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY) || '{}');
    const next = { ...defaults };
    for (const source of SOURCES) {
      if (typeof saved[source.id] === 'boolean') next[source.id] = saved[source.id];
    }
    return Object.values(next).some(Boolean) ? next : defaults;
  } catch {
    return defaults;
  }
}

function saveDisplaySources() {
  localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(displaySources));
}

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
  if (source === 'volcengine') {
    return Array.isArray(payload.windows) && payload.windows.some(item =>
      numeric(item?.total) != null || numeric(item?.usedPercent) != null
    );
  }
  return [
    numeric(payload.balance),
    numeric(payload.todayCost),
    numeric(payload.todayTokens),
    numeric(payload.account?.cumulativeCost),
    numeric(payload.account?.monthlyCost),
    numeric(payload.models?.flash?.tokens),
    numeric(payload.models?.pro?.tokens)
  ].some(value => value != null);
}

function sourceInstruction(source) {
  if (source === 'volcengine') return '进入 Agent Plan 企业版的“用量统计”，再点同步至 Kindle';
  return '打开页面登录后，点击同步至 Kindle';
}

function updateSourceCard(source, payload) {
  const card = document.querySelector(`#open-${source}`);
  const status = document.querySelector(`#${source}-connection`);
  const detail = document.querySelector(`#${source}-detail`);
  if (!card || !status || !detail) return;
  if (!payload) {
    card.dataset.state = 'idle';
    status.textContent = '需要登录或导航';
    detail.textContent = sourceInstruction(source);
  } else if (!hasUsefulData(source, payload)) {
    card.dataset.state = 'error';
    status.textContent = '未读取到用量';
    detail.textContent = payload.diagnostics?.instruction || payload.diagnostics?.directError || sourceInstruction(source);
  } else {
    card.dataset.state = 'connected';
    status.textContent = '已连接';
    detail.textContent = formatSyncTime(payload.capturedAt);
  }
}

function stateForRender() {
  return { ...state, displaySources };
}

function renderToContext(targetCtx, width, height) {
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.setTransform(width / 600, 0, 0, height / 800, 0, 0);
  renderKindleDashboard(targetCtx, stateForRender());
  targetCtx.restore();
}

function renderPreview() {
  renderToContext(previewCtx, 600, 800);
}

function updateProfileUi() {
  const profile = getKindleProfile(selectedProfileId);
  document.querySelector('#format-note').textContent = `${profile.width} × ${profile.height} · 8 位灰度 PNG`;
  document.querySelector('#profile-description').textContent = profile.models;
}

function reportPublishError(error) {
  document.querySelector('#service').textContent = `生成失败：${error?.message || error}`;
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
    schedulePublish(0);
  });
  updateProfileUi();
}

function initializeSourceSelection() {
  for (const source of SOURCES) {
    const input = document.querySelector(`#display-${source.id}`);
    if (!input) continue;
    input.checked = displaySources[source.id];
    input.addEventListener('change', () => {
      const next = { ...displaySources, [source.id]: input.checked };
      if (!Object.values(next).some(Boolean)) {
        input.checked = true;
        document.querySelector('#service').textContent = '至少保留一个统计来源';
        return;
      }
      displaySources = next;
      saveDisplaySources();
      schedulePublish(0);
    });
  }
}

function updateRefreshUi() {
  document.querySelector('#refresh-minutes').value = String(state.refreshMinutes);
  document.querySelector('#refresh-value').textContent = refreshDescription(state.refreshMinutes);
}

function rejectWorkerRequests(error) {
  for (const request of pngWorkerRequests.values()) request.reject(error);
  pngWorkerRequests.clear();
}

function getPngWorker() {
  if (pngWorkerFailed || typeof Worker !== 'function') return null;
  if (pngWorker) return pngWorker;
  try {
    pngWorker = new Worker(new URL('./png-worker.js', import.meta.url), { type: 'module' });
    pngWorker.onmessage = event => {
      const { id, png, error } = event.data || {};
      const request = pngWorkerRequests.get(id);
      if (!request) return;
      pngWorkerRequests.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(new Uint8Array(png));
    };
    pngWorker.onerror = event => {
      pngWorkerFailed = true;
      const error = new Error(event.message || 'PNG 后台线程失败');
      rejectWorkerRequests(error);
      pngWorker?.terminate();
      pngWorker = null;
    };
    return pngWorker;
  } catch {
    pngWorkerFailed = true;
    return null;
  }
}

function encodeDashboardPng(width, height, rgba) {
  const worker = getPngWorker();
  if (!worker) return Promise.resolve(encodeGrayscalePng(width, height, rgbaToGrayscale(rgba)));
  const id = ++pngWorkerRequestId;
  return new Promise((resolve, reject) => {
    pngWorkerRequests.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, width, height, rgba: rgba.buffer }, [rgba.buffer]);
    } catch (error) {
      pngWorkerRequests.delete(id);
      reject(error);
    }
  });
}

async function renderAndStoreDashboard() {
  renderPreview();
  if (!invoke) return;
  const profile = getKindleProfile(selectedProfileId);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = profile.width;
  outputCanvas.height = profile.height;
  const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  renderToContext(outputCtx, profile.width, profile.height);
  const rgba = outputCtx.getImageData(0, 0, profile.width, profile.height).data;
  const png = await encodeDashboardPng(profile.width, profile.height, rgba);
  const check = verifyKindlePng(png, profile.width, profile.height);
  if (!check.ok) throw new Error(check.error);
  await invoke('set_dashboard_png', { bytes: Array.from(png), profile: profile.id });
}

async function publish() {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  if (publishInFlight) {
    publishQueued = true;
    return publishInFlight;
  }
  publishInFlight = (async () => {
    do {
      publishQueued = false;
      await renderAndStoreDashboard();
    } while (publishQueued);
  })().finally(() => {
    publishInFlight = null;
  });
  return publishInFlight;
}

function schedulePublish(delay = PUBLISH_DEBOUNCE_MS) {
  renderPreview();
  if (!invoke) return;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    publish().catch(reportPublishError);
  }, delay);
}

function updateUi() {
  for (const source of SOURCES) {
    updateSourceCard(source.id, state[source.id]);
    const diagnostic = diagnosticSnapshot(source.id, state[source.id]);
    const panel = document.querySelector(`#${source.id}-status`);
    if (panel) panel.textContent = diagnostic ? JSON.stringify(diagnostic, null, 2) : '尚未采集';
  }
  updateRefreshUi();
  schedulePublish();
}

async function applySavedRefreshInterval() {
  const saved = normalizeRefreshMinutes(localStorage.getItem(REFRESH_STORAGE_KEY));
  const settings = await invoke('set_refresh_interval', { minutes: saved });
  state.refreshMinutes = normalizeRefreshMinutes(settings.refreshMinutes);
  localStorage.setItem(REFRESH_STORAGE_KEY, String(state.refreshMinutes));
  document.querySelector('#url').textContent = settings.imageUrl;
  document.querySelector('#browser-url').textContent = settings.browserUrl;
}

function browserPreviewState() {
  return {
    codex: {
      capturedAt: new Date().toISOString(),
      quotas: [
        { id: 'weekly', remainingPercent: 62, usedPercent: 38, resetText: '3 天后重置' },
        { id: '5h', remainingPercent: 74, usedPercent: 26, resetText: '1 小时后重置' }
      ]
    },
    deepseek: {
      capturedAt: new Date().toISOString(),
      balance: { value: 108.2 },
      todayCost: { value: 2.34 },
      todayTokens: { value: 1530000 },
      account: { cumulativeCost: 286.4, monthlyCost: 42.8, monthlyTokens: 28400000 },
      models: {
        flash: { tokens: 890000, cost: 0.82, cacheRate: 76 },
        pro: { tokens: 640000, cost: 1.52, cacheRate: 68 }
      }
    },
    volcengine: {
      capturedAt: new Date().toISOString(),
      windows: [
        { id: '5h', label: '近5小时用量', used: 325.22, total: 4000, usedPercent: 8.13, resetText: '2 小时后重置' },
        { id: 'weekly', label: '近一周用量', used: 322, total: 14000, usedPercent: 2.3, resetText: '4 天后重置' },
        { id: 'monthly', label: '近一月用量', used: 320, total: 40000, usedPercent: 0.8, resetText: '18 天后重置' }
      ]
    }
  };
}

async function load() {
  initializeProfileSelect();
  initializeSourceSelection();
  if (!invoke) {
    state = { ...state, ...browserPreviewState() };
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
  const name = SOURCES.find(item => item.id === source)?.name || source;
  document.querySelector('#service').textContent = `正在打开 ${name}…`;
  try {
    await invoke?.('open_source', { source });
    document.querySelector('#service').textContent = source === 'volcengine'
      ? '请进入 Agent Plan 企业版的“用量统计”，看到 AFP 卡片后点击“同步至 Kindle”'
      : `${name} 页面已打开，请登录后点击“同步至 Kindle”`;
  } catch (error) {
    document.querySelector('#service').textContent = `打开失败：${error}`;
  }
}

async function refreshNow() {
  const button = document.querySelector('#refresh');
  if (refreshInFlight) {
    document.querySelector('#service').textContent = serviceDescription('刷新已经在进行');
    return;
  }
  refreshInFlight = true;
  button.disabled = true;
  document.querySelector('#service').textContent = '正在重新载入数据源…';
  try {
    await invoke?.('refresh_sources');
    document.querySelector('#service').textContent = serviceDescription('已触发刷新，等待页面返回');
  } catch (error) {
    document.querySelector('#service').textContent = `刷新失败：${error}`;
  } finally {
    setTimeout(() => {
      refreshInFlight = false;
      button.disabled = false;
    }, 700);
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
  } catch (error) {
    document.querySelector('#service').textContent = `保存失败：${error}`;
  }
}

async function copyText(selector, button, successText) {
  try {
    await navigator.clipboard.writeText(document.querySelector(selector).textContent);
    const previous = button.textContent;
    button.textContent = successText;
    setTimeout(() => { button.textContent = previous; }, 1200);
  } catch {
    document.querySelector('#service').textContent = '复制失败，请手动选择地址';
  }
}

for (const source of SOURCES) {
  document.querySelector(`#open-${source.id}`)?.addEventListener('click', () => openSource(source.id));
}
document.querySelector('#refresh').onclick = refreshNow;
document.querySelector('#save-refresh').onclick = saveRefreshInterval;
document.querySelector('#refresh-minutes').addEventListener('keydown', event => {
  if (event.key === 'Enter') saveRefreshInterval();
});
document.querySelector('#copy').onclick = event => copyText('#url', event.currentTarget, '已复制');
document.querySelector('#copy-browser').onclick = event => copyText('#browser-url', event.currentTarget, '已复制');
load().catch(error => {
  document.querySelector('#service').textContent = `启动失败：${error}`;
});
