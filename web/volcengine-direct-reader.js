(() => {
  'use strict';
  if (location.hostname !== 'console.volcengine.com' || window.__TOKEN_ON_KINDLE_VOLCENGINE_API_WORKER__) return;
  window.__TOKEN_ON_KINDLE_VOLCENGINE_API_WORKER__ = true;

  const ENTERPRISE_URL = 'https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan-enterprise';
  const WORKER_URL = 'https://console.volcengine.com/robots.txt#token-on-kindle-api-worker';
  const TEMPLATE_KEY = '__token_on_kindle_volcengine_api_templates_v1';
  const PENDING_OPTIONS_KEY = '__token_on_kindle_volcengine_pending_options_v1';
  const TARGET_ACTIONS = [
    'GetAgentPlanSeatAFPUsage',
    'ListAgentPlanUsageDetailObjects',
    'GetAgentPlanSeatUsageDetails'
  ];
  const SAFE_HEADERS = new Set(['accept', 'content-type', 'x-csrf-token', 'x-web-id']);
  const originalFetch = window.fetch.bind(window);
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const finite = value => {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const parsed = Number(String(value).replaceAll(',', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  };

  const state = {
    templates: loadTemplates(),
    bodies: new Map(),
    collecting: false,
    lastPayload: null,
    bootstrapTimer: null,
    transitionTimer: null,
    authFailures: 0
  };

  function isWorkerPage() {
    return location.pathname === '/robots.txt' && location.hash === '#token-on-kindle-api-worker';
  }

  function actionFromUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      if (url.origin !== location.origin) return null;
      return TARGET_ACTIONS.find(action => url.pathname.endsWith(`/${action}`)) || null;
    } catch {
      return null;
    }
  }

  function loadTemplates() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(TEMPLATE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function persistTemplates() {
    try {
      sessionStorage.setItem(TEMPLATE_KEY, JSON.stringify(state.templates));
    } catch (error) {
      console.warn('[Token on Kindle] unable to persist Volcengine request templates', error);
    }
  }

  function filteredHeaders(headers) {
    const result = {};
    try {
      new Headers(headers || {}).forEach((value, key) => {
        const normalized = key.toLowerCase();
        if (SAFE_HEADERS.has(normalized)) result[key] = value;
      });
    } catch {
      for (const [key, value] of Object.entries(headers || {})) {
        if (SAFE_HEADERS.has(String(key).toLowerCase())) result[key] = String(value);
      }
    }
    return result;
  }

  function storeTemplate(action, request = {}) {
    if (!action || !TARGET_ACTIONS.includes(action)) return;
    const body = typeof request.body === 'string'
      ? request.body
      : request.body == null
        ? null
        : JSON.stringify(request.body);
    const previous = state.templates[action] || {};
    state.templates[action] = {
      action,
      url: String(request.url || previous.url || ''),
      method: String(request.method || previous.method || 'POST').toUpperCase(),
      headers: {
        ...(previous.headers || {}),
        ...filteredHeaders(request.headers || {})
      },
      body: body ?? previous.body ?? null,
      referrer: ENTERPRISE_URL,
      capturedAt: new Date().toISOString()
    };
    persistTemplates();
  }

  function allTemplatesReady() {
    return TARGET_ACTIONS.every(action => {
      const template = state.templates[action];
      return template?.url && template?.method && (template.method === 'GET' || template.body != null);
    });
  }

  function allBodiesReady() {
    return TARGET_ACTIONS.every(action => state.bodies.has(action));
  }

  function toolbarStatus(message, stateName = '') {
    const note = document.querySelector('#__token_on_kindle_status') || document.querySelector('#token-on-kindle-worker-status');
    if (!note) return;
    note.textContent = message;
    note.dataset.state = stateName;
  }

  function applySyncOptions(options = {}) {
    const refreshMinutes = finite(options.refreshMinutes ?? options.refresh_minutes);
    if (refreshMinutes != null) sessionStorage.setItem('__token_on_kindle_refresh_minutes', String(refreshMinutes));
    if (options.syncRequestedAt) sessionStorage.setItem('__token_on_kindle_sync_requested_at', String(options.syncRequestedAt));
  }

  function encodeSignal(payload) {
    const refreshMinutes = finite(sessionStorage.getItem('__token_on_kindle_refresh_minutes'));
    const syncRequestedAt = sessionStorage.getItem('__token_on_kindle_sync_requested_at') || null;
    const compact = window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__?.('volcengine', {
      ...payload,
      updateIntervalMinutes: refreshMinutes,
      syncRequestedAt
    }) || { ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt };
    const bytes = new TextEncoder().encode(JSON.stringify(compact));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  function signal(payload) {
    const title = document.title;
    document.title = `__TOKEN_ON_KINDLE__:volcengine:${encodeSignal(payload)}`;
    setTimeout(() => {
      document.title = title || (isWorkerPage() ? 'Token on Kindle · 火山接口 Worker' : '火山方舟');
    }, 280);
  }

  function parseJsonText(text) {
    if (!text || typeof text !== 'string') return null;
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function captureResponse(action, body) {
    if (!action || !body || typeof body !== 'object') return;
    state.bodies.set(action, body);
    scheduleBootstrapCompletion();
  }

  function scheduleBootstrapCompletion() {
    if (!allTemplatesReady() || !allBodiesReady() || isWorkerPage()) return;
    if (state.bootstrapTimer) clearTimeout(state.bootstrapTimer);
    state.bootstrapTimer = setTimeout(() => {
      state.bootstrapTimer = null;
      collectDirect({ startup: true, captured: true, reloadPass: true })
        .then(payload => {
          if (payload) transitionToWorker();
        })
        .catch(error => {
          toolbarStatus(`接口初始化失败：${String(error?.message || error).slice(0, 70)}`, 'warning');
        });
    }, 250);
  }

  window.fetch = async function tokenOnKindleVolcengineFetch(input, init = {}) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const action = actionFromUrl(url);
    if (action) {
      const inputHeaders = typeof input === 'object' && input?.headers ? input.headers : {};
      const mergedHeaders = new Headers(inputHeaders);
      new Headers(init.headers || {}).forEach((value, key) => mergedHeaders.set(key, value));
      storeTemplate(action, {
        url,
        method: init.method || input?.method || 'GET',
        headers: mergedHeaders,
        body: init.body
      });
    }
    const response = await originalFetch(input, init);
    if (action) {
      response.clone().text().then(text => {
        const body = parseJsonText(text);
        if (body) captureResponse(action, body);
      }).catch(() => {});
    }
    return response;
  };

  XMLHttpRequest.prototype.open = function tokenOnKindleVolcengineOpen(method, url, ...rest) {
    this.__tokenOnKindleRequest = {
      action: actionFromUrl(url),
      method: String(method || 'GET').toUpperCase(),
      url: String(url || ''),
      headers: {}
    };
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function tokenOnKindleVolcengineHeader(name, value) {
    const request = this.__tokenOnKindleRequest;
    if (request?.action && SAFE_HEADERS.has(String(name).toLowerCase())) {
      request.headers[name] = String(value);
    }
    return originalXhrSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function tokenOnKindleVolcengineSend(body) {
    const request = this.__tokenOnKindleRequest;
    if (request?.action) {
      storeTemplate(request.action, { ...request, body });
      this.addEventListener('loadend', () => {
        const parsed = parseJsonText(this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText);
        if (parsed) captureResponse(request.action, parsed);
      }, { once: true });
    }
    return originalXhrSend.call(this, body);
  };

  function temporalDescriptor(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 10_000_000_000) return { milliseconds: value, format: 'milliseconds' };
      if (value > 1_000_000_000) return { milliseconds: value * 1000, format: 'seconds' };
      return null;
    }
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const milliseconds = new Date(`${text}T00:00:00`).getTime();
      return Number.isFinite(milliseconds) ? { milliseconds, format: 'date' } : null;
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
      const milliseconds = new Date(text.replace(' ', 'T')).getTime();
      return Number.isFinite(milliseconds) ? { milliseconds, format: 'local-datetime' } : null;
    }
    const milliseconds = Date.parse(text);
    return Number.isFinite(milliseconds) ? { milliseconds, format: 'iso' } : null;
  }

  function formatTemporal(milliseconds, format) {
    const date = new Date(milliseconds);
    const two = value => String(value).padStart(2, '0');
    if (format === 'milliseconds') return Math.round(milliseconds);
    if (format === 'seconds') return Math.floor(milliseconds / 1000);
    if (format === 'date') return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    if (format === 'local-datetime') {
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
    }
    return date.toISOString();
  }

  function rollTimeRange(object, depth = 0) {
    if (!object || typeof object !== 'object' || depth > 10) return false;
    if (!Array.isArray(object)) {
      const startKey = Object.keys(object).find(key => key.toLowerCase() === 'starttime');
      const endKey = Object.keys(object).find(key => key.toLowerCase() === 'endtime');
      if (startKey && endKey) {
        const start = temporalDescriptor(object[startKey]);
        const end = temporalDescriptor(object[endKey]);
        if (start && end) {
          const span = Math.max(60 * 60 * 1000, end.milliseconds - start.milliseconds);
          let nextEnd = Date.now();
          if (end.format === 'date') {
            const now = new Date();
            nextEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          }
          object[endKey] = formatTemporal(nextEnd, end.format);
          object[startKey] = formatTemporal(nextEnd - span, start.format);
          return true;
        }
      }
    }
    for (const child of Object.values(object)) {
      if (child && typeof child === 'object' && rollTimeRange(child, depth + 1)) return true;
    }
    return false;
  }

  function replayBody(template) {
    if (!template?.body || template.method === 'GET' || template.method === 'HEAD') return template?.body || null;
    const parsed = parseJsonText(template.body);
    if (!parsed) return template.body;
    rollTimeRange(parsed);
    return JSON.stringify(parsed);
  }

  async function replayTemplate(action) {
    const template = state.templates[action];
    if (!template) throw new Error(`缺少 ${action} 请求模板`);
    const body = replayBody(template);
    const response = await originalFetch(template.url, {
      method: template.method || 'POST',
      headers: filteredHeaders(template.headers || {}),
      body: ['GET', 'HEAD'].includes(template.method) ? undefined : body,
      credentials: 'include',
      cache: 'no-store',
      referrer: ENTERPRISE_URL,
      referrerPolicy: 'strict-origin-when-cross-origin'
    });
    if (!response.ok) throw new Error(`${action}: HTTP ${response.status}`);
    const parsed = await response.json();
    if (!parsed || typeof parsed !== 'object' || !parsed.Result) {
      throw new Error(`${action}: 登录态或 CSRF 已失效`);
    }
    return { body: parsed, requestBody: parseJsonText(body) };
  }

  async function collectDirect(options = {}) {
    if (state.collecting) return state.lastPayload;
    if (!allTemplatesReady()) throw new Error('等待企业版页面建立接口模板');
    state.collecting = true;
    applySyncOptions(options);
    toolbarStatus('正在通过火山控制台接口读取 AFP 与模型 Token…');
    try {
      const [afp, modelList, usage] = await Promise.all([
        replayTemplate('GetAgentPlanSeatAFPUsage'),
        replayTemplate('ListAgentPlanUsageDetailObjects'),
        replayTemplate('GetAgentPlanSeatUsageDetails')
      ]);
      const payload = window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_INTERNAL_API__?.({
        afpBody: afp.body,
        modelListBody: modelList.body,
        usageBody: usage.body,
        usageRequestBody: usage.requestBody,
        capturedAt: new Date().toISOString()
      });
      if (!payload || payload.windows?.length !== 3) throw new Error('AFP 接口响应结构不完整');
      if (!Array.isArray(payload.models)) throw new Error('模型用量接口响应结构不完整');
      payload.url = isWorkerPage() ? WORKER_URL : ENTERPRISE_URL;
      payload.diagnostics = {
        ...(payload.diagnostics || {}),
        lifecycle: 'v0.6.2-reload-worker',
        workerPage: isWorkerPage(),
        templateActions: TARGET_ACTIONS
      };
      state.lastPayload = payload;
      state.authFailures = 0;
      signal(payload);
      toolbarStatus(`接口同步完成：3 个 AFP 周期，${payload.models.length} 个模型`, 'success');
      return payload;
    } catch (error) {
      state.authFailures += 1;
      throw error;
    } finally {
      state.collecting = false;
    }
  }

  function transitionToWorker() {
    if (isWorkerPage() || state.transitionTimer) return;
    state.transitionTimer = setTimeout(() => {
      state.transitionTimer = null;
      document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard';
      setTimeout(() => location.replace(WORKER_URL), 180);
    }, 320);
  }

  function resetTemplatesAndBootstrap(error) {
    console.warn('[Token on Kindle] Volcengine API session needs bootstrap', error);
    state.templates = {};
    state.bodies.clear();
    sessionStorage.removeItem(TEMPLATE_KEY);
    toolbarStatus('火山登录态已失效；请重新登录企业版控制台', 'warning');
    if (isWorkerPage()) location.replace(ENTERPRISE_URL);
  }

  async function runWorkerSync(options = {}) {
    try {
      return await collectDirect({ ...options, reloadPass: true });
    } catch (error) {
      resetTemplatesAndBootstrap(error);
      return null;
    }
  }

  function queueReload(options = {}) {
    applySyncOptions(options);
    try {
      sessionStorage.setItem(PENDING_OPTIONS_KEY, JSON.stringify(options));
    } catch {}
    location.reload();
  }

  async function directSync(options = {}) {
    applySyncOptions(options);
    if (isWorkerPage() && !options.reloadPass && !options.startup) {
      queueReload(options);
      return state.lastPayload;
    }
    if (!allTemplatesReady()) {
      if (isWorkerPage()) location.replace(ENTERPRISE_URL);
      toolbarStatus('等待登录后建立火山接口会话', 'warning');
      return null;
    }
    try {
      const payload = await collectDirect({ ...options, reloadPass: true });
      if (!isWorkerPage()) transitionToWorker();
      return payload;
    } catch (error) {
      resetTemplatesAndBootstrap(error);
      return null;
    }
  }

  function installSyncOverride() {
    window.__TOKEN_ON_KINDLE_SYNC__ = directSync;
    const button = [...document.querySelectorAll('#__token_on_kindle_toolbar button')]
      .find(element => String(element.textContent || '').trim() === '同步至 Kindle');
    if (button && button.dataset.volcengineApiWorker !== 'true') {
      button.dataset.volcengineApiWorker = 'true';
      button.onclick = () => directSync({ manual: true });
    }
  }

  function renderWorkerShell() {
    if (!isWorkerPage()) return;
    const render = () => {
      document.title = 'Token on Kindle · 火山接口 Worker';
      document.documentElement.lang = 'zh-CN';
      document.body.innerHTML = `
        <main style="font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;padding:24px;line-height:1.6">
          <h1 style="font-size:22px">火山方舟接口 Worker</h1>
          <p id="token-on-kindle-worker-status">后台窗口仅保留控制台登录会话，不加载企业版用量界面。</p>
          <p>打开此窗口时会自动进入登录页面；后台刷新只调用内部只读接口。</p>
          <button id="token-on-kindle-open-login" type="button">打开火山登录页面</button>
        </main>`;
      document.querySelector('#token-on-kindle-open-login')?.addEventListener('click', () => location.replace(ENTERPRISE_URL));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
    else render();
  }

  function pendingOptions() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(PENDING_OPTIONS_KEY) || '{}');
      sessionStorage.removeItem(PENDING_OPTIONS_KEY);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function start() {
    installSyncOverride();
    if (isWorkerPage()) {
      renderWorkerShell();
      const options = pendingOptions();
      setTimeout(() => {
        installSyncOverride();
        runWorkerSync({ ...options, automatic: true, startup: true }).catch(() => {});
      }, 280);
      window.addEventListener('focus', () => {
        if (document.visibilityState === 'visible') location.replace(ENTERPRISE_URL);
      });
      return;
    }

    toolbarStatus('正在建立火山控制台接口会话；成功后将切换到轻量后台 Worker');
    if (allTemplatesReady()) {
      setTimeout(() => {
        directSync({ automatic: true, startup: true }).catch(() => {});
      }, 800);
    }
    for (const delay of [1800, 4200, 8000]) {
      setTimeout(() => {
        installSyncOverride();
        scheduleBootstrapCompletion();
      }, delay);
    }
  }

  window.addEventListener('pageshow', () => {
    installSyncOverride();
    if (isWorkerPage()) setTimeout(() => runWorkerSync({ automatic: true, pageshow: true, startup: true }), 350);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();