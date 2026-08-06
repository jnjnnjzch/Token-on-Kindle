(() => {
  'use strict';
  if (!location.hostname.endsWith('volcengine.com') || window.__TOKEN_ON_KINDLE_VOLCENGINE_DEBUG_BOOTSTRAPPED__) return;
  window.__TOKEN_ON_KINDLE_VOLCENGINE_DEBUG_BOOTSTRAPPED__ = true;

  const ENABLE_KEY = '__token_on_kindle_volcengine_debug_enabled';
  const REPORT_KEY = '__token_on_kindle_volcengine_debug_report';
  const MAX_ENTRIES = 60;
  const MAX_REPLAY_TEMPLATES = 20;
  const MAX_JSON_BYTES = 4_000_000;
  const core = window.__TOKEN_ON_KINDLE_VOLCENGINE_DEBUG_CORE__;
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const number = value => {
    const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const scaled = value => {
    const text = String(value ?? '').replaceAll(',', '').trim();
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    let parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) return null;
    if (/亿/.test(text)) parsed *= 100_000_000;
    else if (/万/.test(text)) parsed *= 10_000;
    return parsed;
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isEnabled = () => {
    try { return localStorage.getItem(ENABLE_KEY) === '1'; } catch { return false; }
  };
  const setEnabled = enabled => {
    try { localStorage.setItem(ENABLE_KEY, enabled ? '1' : '0'); } catch { /* storage unavailable */ }
  };

  function installToggleButton() {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const toolbar = document.querySelector('#__token_on_kindle_toolbar');
      if (!toolbar) {
        if (Date.now() - startedAt > 20_000) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      if (document.querySelector('#__token_on_kindle_volcengine_debug_toggle')) return;
      const button = document.createElement('button');
      button.id = '__token_on_kindle_volcengine_debug_toggle';
      button.type = 'button';
      button.textContent = isEnabled() ? '关闭火山诊断' : '开启火山诊断';
      button.onclick = () => {
        setEnabled(!isEnabled());
        location.reload();
      };
      const hide = [...toolbar.querySelectorAll('button')].find(element => clean(element.textContent) === '隐藏');
      toolbar.insertBefore(button, hide || null);
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installToggleButton, { once: true });
  else installToggleButton();
  if (!isEnabled() || !core) return;

  const state = {
    startedAt: new Date().toISOString(),
    order: 0,
    entries: [],
    replayTemplates: [],
    lastReport: null,
    panel: null,
    output: null
  };
  const originalFetch = window.fetch?.bind(window);
  const secretHeader = /^(authorization|cookie|proxy-authorization)$/i;

  function allowedUrl(rawUrl) {
    try {
      const hostname = new URL(String(rawUrl || ''), location.href).hostname;
      return /(?:^|\.)(?:volcengine\.com|volces\.com|volcengineapi\.com)$/i.test(hostname);
    } catch {
      return false;
    }
  }

  function headerPairs(headers) {
    try { return [...new Headers(headers || {}).entries()]; } catch { return []; }
  }

  function reportHeaderNames(headers) {
    return headerPairs(headers).map(([key]) => key).filter(key => !secretHeader.test(key)).sort();
  }

  function replayHeaders(headers) {
    const output = {};
    for (const [key, value] of headerPairs(headers)) {
      if (secretHeader.test(key)) continue;
      output[key] = value;
    }
    return output;
  }

  function bodyText(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    if (value instanceof URLSearchParams) return value.toString();
    if (typeof FormData !== 'undefined' && value instanceof FormData) return null;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return null;
    try { return JSON.stringify(value); } catch { return null; }
  }

  function describeFetch(args) {
    const input = args[0];
    const init = args[1] || {};
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const url = request?.url || input?.url || input;
    const headers = init.headers || request?.headers || {};
    let bodyPromise = Promise.resolve(bodyText(init.body));
    if (init.body == null && request && !/^(GET|HEAD)$/i.test(method)) {
      bodyPromise = request.clone().text().catch(() => null);
    }
    return { method, url: String(url || ''), headers, bodyPromise };
  }

  function pushEntry(entry, template = null) {
    state.entries.push(entry);
    if (state.entries.length > MAX_ENTRIES) state.entries.splice(0, state.entries.length - MAX_ENTRIES);
    if (template && core.isSafeVolcengineReplayCandidate(template)) {
      state.replayTemplates.push(template);
      if (state.replayTemplates.length > MAX_REPLAY_TEMPLATES) {
        state.replayTemplates.splice(0, state.replayTemplates.length - MAX_REPLAY_TEMPLATES);
      }
    }
    refreshPanelStatus();
  }

  async function parseResponseBody(text, metadata, template) {
    if (!text || text.length > MAX_JSON_BYTES) {
      pushEntry({ ...metadata, response: { byteLength: text?.length || 0, skipped: text ? 'too-large' : 'empty' } }, template);
      return;
    }
    let payload;
    try { payload = JSON.parse(text); } catch {
      pushEntry({ ...metadata, response: { byteLength: text.length, skipped: 'non-json' } }, template);
      return;
    }
    const classification = core.classifyVolcengineDebugPayload(payload);
    pushEntry({
      ...metadata,
      response: {
        byteLength: text.length,
        relevant: classification.relevant,
        score: classification.score,
        kinds: classification.kinds,
        topLevelKeys: classification.topLevelKeys,
        matchedPaths: classification.matchedPaths,
        relevantValues: classification.relevantValues,
        pathCount: classification.pathCount
      }
    }, template);
  }

  if (originalFetch) {
    window.fetch = async (...args) => {
      const descriptor = describeFetch(args);
      const started = performance.now();
      const response = await originalFetch(...args);
      if (allowedUrl(response.url || descriptor.url)) {
        const body = await descriptor.bodyPromise.catch(() => null);
        const template = {
          method: descriptor.method,
          url: response.url || descriptor.url,
          headers: replayHeaders(descriptor.headers),
          body,
          bodySummary: core.summarizeVolcengineRequestBody(body)
        };
        const metadata = {
          id: ++state.order,
          capturedAt: new Date().toISOString(),
          transport: 'fetch',
          method: descriptor.method,
          url: core.sanitizeVolcengineUrl(response.url || descriptor.url, location.href),
          request: {
            headerNames: reportHeaderNames(descriptor.headers),
            body: template.bodySummary
          },
          status: response.status,
          elapsedMs: Math.round(performance.now() - started)
        };
        response.clone().text().then(text => parseResponseBody(text, metadata, template)).catch(() => {});
      }
      return response;
    };
  }

  const xhrProto = window.XMLHttpRequest?.prototype;
  if (xhrProto && !xhrProto.__tokenOnKindleVolcengineDebugWrapped) {
    xhrProto.__tokenOnKindleVolcengineDebugWrapped = true;
    const originalOpen = xhrProto.open;
    const originalSend = xhrProto.send;
    const originalSetRequestHeader = xhrProto.setRequestHeader;
    xhrProto.open = function(method, url, ...rest) {
      this.__tokenOnKindleVolcengineDebug = {
        method: String(method || 'GET').toUpperCase(),
        url: String(url || ''),
        headers: {},
        started: 0,
        body: null
      };
      return originalOpen.call(this, method, url, ...rest);
    };
    xhrProto.setRequestHeader = function(name, value) {
      if (this.__tokenOnKindleVolcengineDebug) this.__tokenOnKindleVolcengineDebug.headers[name] = value;
      return originalSetRequestHeader.call(this, name, value);
    };
    xhrProto.send = function(body, ...rest) {
      const descriptor = this.__tokenOnKindleVolcengineDebug || { method: 'GET', url: '', headers: {} };
      descriptor.started = performance.now();
      descriptor.body = bodyText(body);
      this.addEventListener('loadend', () => {
        const rawUrl = this.responseURL || descriptor.url;
        if (!allowedUrl(rawUrl)) return;
        const template = {
          method: descriptor.method,
          url: rawUrl,
          headers: replayHeaders(descriptor.headers),
          body: descriptor.body,
          bodySummary: core.summarizeVolcengineRequestBody(descriptor.body)
        };
        const metadata = {
          id: ++state.order,
          capturedAt: new Date().toISOString(),
          transport: 'xhr',
          method: descriptor.method,
          url: core.sanitizeVolcengineUrl(rawUrl, location.href),
          request: {
            headerNames: reportHeaderNames(descriptor.headers),
            body: template.bodySummary
          },
          status: this.status,
          elapsedMs: Math.round(performance.now() - descriptor.started)
        };
        try {
          const text = this.responseType === 'json' ? JSON.stringify(this.response) : String(this.responseText || '');
          parseResponseBody(text, metadata, template).catch(() => {});
        } catch {
          pushEntry({ ...metadata, response: { skipped: `response-type:${this.responseType || 'unknown'}` } }, template);
        }
      }, { once: true });
      return originalSend.call(this, body, ...rest);
    };
  }

  const WINDOWS = [
    { id: '5h', label: '近5小时用量' },
    { id: 'weekly', label: '近一周用量' },
    { id: 'monthly', label: '近一月用量' }
  ];

  function exactElement(label, root = document) {
    return [...root.querySelectorAll('h1,h2,h3,h4,strong,label,span,p,div')]
      .find(element => clean(element.textContent) === label) || null;
  }

  function readDomCard(definition) {
    const label = exactElement(definition.label);
    if (!label) return null;
    let node = label;
    let card = null;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (!text.includes(definition.label) || text.length > 2200) continue;
      card = node;
      if (node.querySelector('[aria-valuenow], [role="progressbar"], [title]')) break;
    }
    if (!card) return null;
    const text = card.innerText || card.textContent || '';
    const progress = card.querySelector('[aria-valuenow]');
    let usedPercent = number(progress?.getAttribute('aria-valuenow'));
    const ratio = text.match(/([\d,.]+(?:\.\d+)?\s*(?:万|亿)?)\s*(?:AFP)?\s*[/／]\s*([\d,.]+(?:\.\d+)?\s*(?:万|亿)?)/i);
    let used = ratio ? scaled(ratio[1]) : null;
    let total = ratio ? scaled(ratio[2]) : null;
    if (total == null) {
      const titled = [...card.querySelectorAll('[title]')]
        .map(element => scaled(element.getAttribute('title')))
        .filter(value => value != null && value > 0);
      if (titled.length) total = Math.max(...titled);
    }
    if (usedPercent == null) {
      const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
      usedPercent = match ? Number(match[1]) : null;
    }
    if (used == null && total != null && usedPercent != null) used = total * usedPercent / 100;
    if (usedPercent == null && used != null && total) usedPercent = used / total * 100;
    const reset = String(text || '').split(/\n+/).map(clean).find(value => /(?:后重置|后刷新|重置于|下次重置)/.test(value));
    return {
      id: definition.id,
      label: definition.label,
      used,
      total,
      usedPercent,
      remainingPercent: usedPercent == null ? null : Math.max(0, 100 - usedPercent),
      resetText: reset ? reset.slice(0, 80) : null
    };
  }

  function readDom() {
    const windows = WINDOWS.map(readDomCard).filter(Boolean);
    return { windows, ready: windows.length === WINDOWS.length };
  }

  function modelSection() {
    const title = exactElement('模型调用明细');
    if (!title) return null;
    let node = title;
    let best = title.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (!text.includes('模型调用明细') || text.length > 30_000) continue;
      best = node;
      if (node.querySelector('.echarts-for-react[_echarts_instance_], [_echarts_instance_]')) break;
    }
    return best;
  }

  function readEcharts() {
    const root = modelSection();
    const chart = root?.querySelector('.echarts-for-react[_echarts_instance_], [_echarts_instance_]') || null;
    const names = root ? [...root.querySelectorAll('[class*="legendItem"][title], [class*="legendBox"] [title], [class*="legendName"]')]
      .map(element => clean(element.getAttribute('title') || element.textContent)).filter(Boolean) : [];
    const legendNames = [...new Map(names.map(name => [name.toLowerCase(), name])).values()];
    const dates = root ? [...root.querySelectorAll('input[placeholder="开始日期"], input[placeholder="结束日期"]')]
      .map(input => clean(input.value)).filter(Boolean) : [];
    const granularity = root ? [...root.querySelectorAll('[class*="granularityTabActive"]')]
      .map(element => clean(element.textContent)).find(value => value === '天' || value === '小时') : null;
    const access = chart ? window.__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__?.(chart, window.echarts) : null;
    const parsed = access?.option ? window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__?.(
      access.option,
      legendNames,
      { periodStart: dates[0] || null, periodEnd: dates[1] || null, granularity: granularity || null }
    ) : null;
    return {
      ready: Boolean(access?.option),
      chartCount: chart ? 1 : 0,
      accessMethod: access?.method || null,
      chartInstanceId: chart?.getAttribute('_echarts_instance_') || null,
      legendNames,
      models: parsed?.models || [],
      periodStart: parsed?.periodStart || dates[0] || null,
      periodEnd: parsed?.periodEnd || dates[1] || null,
      granularity: parsed?.granularity || granularity || null,
      parser: parsed?.diagnostics || null
    };
  }

  function controlText(element) {
    return clean(element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '');
  }

  function controlContext(element) {
    let node = element;
    let context = '';
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (text && text.length <= 4000) context = text;
      if (/(模型调用明细|用量统计|AFP|开始日期|结束日期)/.test(text)) break;
    }
    return context;
  }

  function triggerPageQuery() {
    const roots = [modelSection(), document].filter(Boolean);
    const seen = new Set();
    for (const root of roots) {
      for (const control of root.querySelectorAll('button,[role="button"]')) {
        if (seen.has(control) || control.disabled || control.getAttribute('aria-disabled') === 'true') continue;
        seen.add(control);
        const label = controlText(control);
        if (!/^(查询|刷新|搜索|更新|query|refresh|search|update)$/i.test(label)) continue;
        if (!/(模型调用明细|用量统计|AFP|开始日期|结束日期)/.test(controlContext(control))) continue;
        try {
          control.click();
          return { clicked: true, label };
        } catch { /* try the next control */ }
      }
    }
    return { clicked: false, label: null };
  }

  async function replayCandidates(limit = 3) {
    if (!originalFetch) return [];
    const unique = [];
    const seen = new Set();
    for (const template of [...state.replayTemplates].reverse()) {
      const key = `${template.method}|${core.sanitizeVolcengineUrl(template.url, location.href)}|${JSON.stringify(template.bodySummary?.keys || [])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(template);
      if (unique.length >= limit) break;
    }
    const results = [];
    for (const template of unique) {
      const started = performance.now();
      try {
        const init = {
          method: template.method,
          headers: template.headers,
          credentials: 'include',
          cache: 'no-store'
        };
        if (!/^(GET|HEAD)$/i.test(template.method) && template.body != null) init.body = template.body;
        const response = await originalFetch(template.url, init);
        const text = await response.clone().text();
        let classification = null;
        try { classification = core.classifyVolcengineDebugPayload(JSON.parse(text)); } catch { /* non-json */ }
        const result = {
          method: template.method,
          url: core.sanitizeVolcengineUrl(template.url, location.href),
          status: response.status,
          elapsedMs: Math.round(performance.now() - started),
          relevant: classification?.relevant || false,
          score: classification?.score || 0,
          kinds: classification?.kinds || [],
          matchedPaths: classification?.matchedPaths || [],
          relevantValues: classification?.relevantValues || {}
        };
        results.push(result);
        pushEntry({
          id: ++state.order,
          capturedAt: new Date().toISOString(),
          transport: 'replay',
          method: template.method,
          url: result.url,
          request: { headerNames: Object.keys(template.headers || {}).filter(name => !secretHeader.test(name)), body: template.bodySummary },
          status: result.status,
          elapsedMs: result.elapsedMs,
          response: {
            byteLength: text.length,
            relevant: result.relevant,
            score: result.score,
            kinds: result.kinds,
            matchedPaths: result.matchedPaths,
            relevantValues: result.relevantValues
          }
        });
      } catch (error) {
        results.push({
          method: template.method,
          url: core.sanitizeVolcengineUrl(template.url, location.href),
          error: String(error?.message || error)
        });
      }
    }
    return results;
  }

  function networkSummary() {
    const relevant = state.entries.filter(entry => entry.response?.relevant);
    return {
      capturedCount: state.entries.length,
      relevantCount: relevant.length,
      replayCandidateCount: state.replayTemplates.length,
      entries: state.entries.map(entry => ({
        id: entry.id,
        capturedAt: entry.capturedAt,
        transport: entry.transport,
        method: entry.method,
        url: entry.url,
        request: entry.request,
        status: entry.status,
        elapsedMs: entry.elapsedMs,
        response: entry.response
      }))
    };
  }

  async function runAll(options = {}) {
    const trigger = options.triggerPageQuery === false ? { clicked: false, skipped: true } : triggerPageQuery();
    if (trigger.clicked) await sleep(1300);
    const replay = options.replay === false ? [] : await replayCandidates(3);
    if (replay.length) await sleep(300);
    const dom = readDom();
    const echarts = readEcharts();
    const network = networkSummary();
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      page: {
        url: core.sanitizeVolcengineUrl(location.href, location.href),
        title: document.title,
        readyState: document.readyState,
        visibilityState: document.visibilityState
      },
      debug: {
        startedAt: state.startedAt,
        trigger,
        replay
      },
      methods: { dom, echarts, network },
      comparison: core.compareVolcengineDebugResults({ dom, echarts, network })
    };
    state.lastReport = report;
    try { sessionStorage.setItem(REPORT_KEY, JSON.stringify(report)); } catch { /* storage unavailable */ }
    renderReport(report);
    return report;
  }

  function clear() {
    state.entries.length = 0;
    state.replayTemplates.length = 0;
    state.lastReport = null;
    try { sessionStorage.removeItem(REPORT_KEY); } catch { /* storage unavailable */ }
    renderReport({ message: '诊断记录已清空。刷新或点击页面查询后重新运行。' });
  }

  async function copyReport() {
    const text = JSON.stringify(state.lastReport || await runAll({ replay: false }), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    }
  }

  function refreshPanelStatus() {
    const status = document.querySelector('#__token_on_kindle_volcengine_debug_status');
    if (!status) return;
    const relevant = state.entries.filter(entry => entry.response?.relevant).length;
    status.textContent = `已捕获 ${state.entries.length} 个 JSON/响应候选，其中 ${relevant} 个结构匹配；可安全重放 ${state.replayTemplates.length} 个。`;
  }

  function renderReport(report) {
    if (!state.output) return;
    state.output.textContent = JSON.stringify(report, null, 2);
    refreshPanelStatus();
  }

  function ensurePanel() {
    if (state.panel?.isConnected) return state.panel;
    const panel = document.createElement('section');
    panel.id = '__token_on_kindle_volcengine_debug_panel';
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'top:72px', 'z-index:2147483646', 'width:min(620px,calc(100vw - 32px))',
      'max-height:calc(100vh - 96px)', 'display:flex', 'flex-direction:column', 'gap:8px', 'padding:12px',
      'background:#fff', 'color:#111', 'border:2px solid #111', 'box-shadow:0 8px 30px rgba(0,0,0,.24)',
      'font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace'
    ].join(';');
    const title = document.createElement('strong');
    title.textContent = '火山方舟多路径诊断（不导出登录凭据）';
    const status = document.createElement('div');
    status.id = '__token_on_kindle_volcengine_debug_status';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const makeButton = (label, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'padding:6px 9px;border:1px solid #111;background:#fff;color:#111;cursor:pointer';
      button.onclick = action;
      actions.append(button);
      return button;
    };
    makeButton('运行全部', () => runAll().catch(error => renderReport({ error: String(error?.message || error) })));
    makeButton('只读比较', () => runAll({ triggerPageQuery: false, replay: false }).catch(error => renderReport({ error: String(error?.message || error) })));
    makeButton('复制报告', async event => {
      const copied = await copyReport();
      event.currentTarget.textContent = copied ? '已复制' : '复制失败';
      setTimeout(() => { event.currentTarget.textContent = '复制报告'; }, 1200);
    });
    makeButton('清空', clear);
    makeButton('收起', () => { panel.style.display = 'none'; });
    const output = document.createElement('pre');
    output.style.cssText = 'margin:0;padding:8px;overflow:auto;min-height:160px;max-height:60vh;background:#f5f5f5;border:1px solid #aaa;white-space:pre-wrap;word-break:break-word';
    panel.append(title, status, actions, output);
    document.documentElement.append(panel);
    state.panel = panel;
    state.output = output;
    refreshPanelStatus();
    try {
      const previous = JSON.parse(sessionStorage.getItem(REPORT_KEY) || 'null');
      if (previous) {
        state.lastReport = previous;
        renderReport(previous);
      } else {
        renderReport({ message: '诊断已启用。等待页面请求完成后点击“运行全部”。' });
      }
    } catch {
      renderReport({ message: '诊断已启用。等待页面请求完成后点击“运行全部”。' });
    }
    return panel;
  }

  function installDebugButton() {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const toolbar = document.querySelector('#__token_on_kindle_toolbar');
      if (!toolbar) {
        if (Date.now() - startedAt > 20_000) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      let button = document.querySelector('#__token_on_kindle_volcengine_debug_open');
      if (!button) {
        button = document.createElement('button');
        button.id = '__token_on_kindle_volcengine_debug_open';
        button.type = 'button';
        button.textContent = '打开诊断面板';
        button.onclick = () => { ensurePanel().style.display = 'flex'; };
        const toggle = document.querySelector('#__token_on_kindle_volcengine_debug_toggle');
        toolbar.insertBefore(button, toggle || null);
      }
      ensurePanel();
    }, 400);
  }

  window.__TOKEN_ON_KINDLE_VOLCENGINE_DEBUG__ = {
    enabled: true,
    runAll,
    readDom,
    readEcharts,
    networkSummary,
    replayCandidates,
    triggerPageQuery,
    copyReport,
    clear,
    disable() { setEnabled(false); location.reload(); },
    get report() { return state.lastReport; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDebugButton, { once: true });
  else installDebugButton();
})();
