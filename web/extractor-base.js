(() => {
  'use strict';
  if (window.__TOKEN_ON_KINDLE_INSTALLED__) return;
  window.__TOKEN_ON_KINDLE_INSTALLED__ = true;

  const host = location.hostname;
  const source = host === 'chatgpt.com' ? 'codex' : host.endsWith('deepseek.com') ? 'deepseek' : host.endsWith('volcengine.com') ? 'volcengine' : null;
  if (!source) return;

  const UPDATE_MS = 10 * 60 * 1000;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const numeric = value => {
    const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const money = value => {
    const text = String(value ?? '').replaceAll(',', '');
    const match = text.match(/(?:¥|￥|CNY|RMB)\s*(-?\d+(?:\.\d+)?)/i)
      || text.match(/(-?\d+(?:\.\d+)?)\s*(?:元|CNY|RMB)/i);
    return match ? Number(match[1]) : null;
  };
  const pageLines = () => clean(document.body?.innerText || '').split(/\n+/).map(clean).filter(Boolean);

  function signal(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const pageTitle = document.title;
    document.title = `__TOKEN_ON_KINDLE__:${source}:${encoded}`;
    setTimeout(() => {
      document.title = pageTitle || (source === 'codex' ? 'Codex Analytics' : source === 'deepseek' ? 'DeepSeek Platform' : '火山方舟 Agent Plan 企业版');
    }, 250);
  }

  function safePath(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      const kept = new URLSearchParams();
      for (const [key, value] of url.searchParams) {
        if (/(model|date|day|start|end|from|to|granularity|interval)/i.test(key)) kept.set(key, value.slice(0, 120));
      }
      const query = kept.toString();
      return `${url.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return String(rawUrl || '').slice(0, 240);
    }
  }

  function installDeepSeekNetworkCapture() {
    if (source !== 'deepseek' || window.__TOKEN_ON_KINDLE_CAPTURE_INSTALLED__) return;
    window.__TOKEN_ON_KINDLE_CAPTURE_INSTALLED__ = true;
    const store = window.__TOKEN_ON_KINDLE_DEEPSEEK_RESPONSES__ = window.__TOKEN_ON_KINDLE_DEEPSEEK_RESPONSES__ || [];
    let order = store.at(-1)?.order || 0;

    const relevant = rawUrl => {
      try {
        const url = new URL(String(rawUrl || ''), location.href);
        return url.hostname.endsWith('deepseek.com')
          && (/\/api\//i.test(url.pathname) || /(usage|amount|cost|billing|consume|stat|token)/i.test(url.pathname));
      } catch {
        return false;
      }
    };

    const remember = (rawUrl, body, transport) => {
      if (!relevant(rawUrl) || !body || typeof body !== 'object') return;
      store.push({
        order: ++order,
        path: safePath(rawUrl),
        transport,
        capturedAt: new Date().toISOString(),
        body
      });
      if (store.length > 60) store.splice(0, store.length - 60);
    };

    const originalFetch = window.fetch?.bind(window);
    if (originalFetch) {
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const rawUrl = response.url || args[0]?.url || args[0];
        if (relevant(rawUrl)) {
          response.clone().text().then(text => {
            if (!text || text.length > 8_000_000) return;
            try { remember(rawUrl, JSON.parse(text), 'fetch'); } catch { /* non-JSON response */ }
          }).catch(() => {});
        }
        return response;
      };
    }

    const proto = window.XMLHttpRequest?.prototype;
    if (proto && !proto.__tokenOnKindleWrapped) {
      proto.__tokenOnKindleWrapped = true;
      const originalOpen = proto.open;
      const originalSend = proto.send;
      proto.open = function(method, url, ...rest) {
        this.__tokenOnKindleUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      proto.send = function(...args) {
        this.addEventListener('load', () => {
          const rawUrl = this.responseURL || this.__tokenOnKindleUrl;
          if (!relevant(rawUrl)) return;
          try {
            const body = this.responseType === 'json' ? this.response : JSON.parse(this.responseText || '');
            remember(rawUrl, body, 'xhr');
          } catch { /* non-JSON response */ }
        }, { once: true });
        return originalSend.apply(this, args);
      };
    }
  }

  installDeepSeekNetworkCapture();

  function resetText(text) {
    const match = text.match(/(?:reset(?:s| at)?|next reset|renew(?:s|al)?|重置|恢复|下次重置)[：:\s]*([^\n|]{1,80})/i);
    return match ? clean(match[1]) : null;
  }

  function quotaKind(text) {
    if (/(weekly|per week|week limit|7[- ]?day|本周|每周|周额度)/i.test(text)) return 'weekly';
    const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|小时)/i);
    if (hours) return `${hours[1]}h`;
    if (/(daily|day limit|today|今日|每天|日额度)/i.test(text)) return 'daily';
    if (/(monthly|month limit|本月|每月|月额度)/i.test(text)) return 'monthly';
    return 'unknown';
  }

  function quotaFrom(value, context) {
    if (value == null || value < 0 || value > 100) return null;
    if (!/(limit|quota|reset|remaining|used|week|hour|额度|限制|重置|剩余|已用|周|小时)/i.test(context)) return null;
    let remainingPercent = null;
    let usedPercent = null;
    if (/(remaining|left|available|剩余|可用)/i.test(context)) {
      remainingPercent = value;
      usedPercent = 100 - value;
    } else if (/(used|usage|consumed|已用|已使用|消耗)/i.test(context)) {
      usedPercent = value;
      remainingPercent = 100 - value;
    }
    return { id: quotaKind(context), displayedPercent: value, remainingPercent, usedPercent, resetText: resetText(context) };
  }

  function collectCodex() {
    const found = [];
    document.querySelectorAll('[role="progressbar"], [aria-valuenow], [aria-valuetext]').forEach(element => {
      const own = clean(element.getAttribute('aria-valuetext') || element.getAttribute('aria-valuenow') || element.textContent || '');
      const value = numeric(own);
      let node = element;
      let context = own;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        const text = clean(node.innerText || node.textContent || '');
        if (text && text.length <= 700) context = text;
        if (/(limit|quota|reset|remaining|used|week|hour|额度|限制|重置|剩余|已用|周|小时)/i.test(text)) break;
      }
      const quota = quotaFrom(value, context);
      if (quota) found.push(quota);
    });
    const lines = pageLines();
    lines.forEach((line, index) => {
      const match = line.match(/(\d+(?:\.\d+)?)\s*%/);
      if (!match) return;
      const context = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join(' | ');
      const quota = quotaFrom(Number(match[1]), context);
      if (quota) found.push(quota);
    });
    const seen = new Set();
    const quotas = found.filter(item => {
      const key = `${item.id}|${item.displayedPercent}|${item.resetText || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.id === 'weekly' ? -1 : b.id === 'weekly' ? 1 : 0);
    return { source, capturedAt: new Date().toISOString(), updateIntervalMinutes: 10, quotas, url: location.href };
  }

  function exactTextElement(value, root = document) {
    return [...root.querySelectorAll('span,div,p')].find(element => clean(element.textContent).toLowerCase() === value.toLowerCase());
  }

  function exactMetricLabels(labels, root = document) {
    const normalized = labels.map(label => label.toLowerCase());
    return [...root.querySelectorAll('span,div,p,label,h1,h2,h3,h4')]
      .filter(element => normalized.includes(clean(element.textContent).toLowerCase()));
  }

  function metricFromLabelAncestor(labels, parser) {
    for (const labelElement of exactMetricLabels(labels)) {
      let node = labelElement.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const raw = clean(node.innerText || node.textContent || '');
        if (!raw || raw.length > 600) continue;
        const value = parser(raw);
        if (value != null) return { value, raw, method: 'label-ancestor' };
      }
    }
    return null;
  }

  function cardMetric(labels, parser = numeric) {
    const normalized = labels.map(label => label.toLowerCase());
    const exactOnly = normalized.some(label => ['cost', '费用', '消耗'].includes(label));
    const cards = [...document.querySelectorAll('[data-usage-layout-card="true"], .usage-layout-card')];
    for (const card of cards) {
      const text = clean(card.innerText || card.textContent || '');
      const exactLabel = exactMetricLabels(labels, card).length > 0;
      const containsLabel = normalized.some(label => text.toLowerCase().includes(label));
      if (!(exactLabel || (!exactOnly && containsLabel))) continue;

      const valueElement = card.querySelector('[data-usage-layout-font="value"]');
      const candidates = [
        { raw: clean(valueElement?.innerText || valueElement?.textContent || ''), method: 'value-node' },
        { raw: clean(card.innerText || ''), method: 'card-inner-text' },
        { raw: clean(card.textContent || ''), method: 'card-text-content' }
      ];
      for (const candidate of candidates) {
        if (!candidate.raw) continue;
        const value = parser(candidate.raw);
        if (value != null) return { value, raw: candidate.raw, method: candidate.method };
      }
    }
    return metricFromLabelAncestor(labels, parser);
  }

  function chartContext(chart) {
    let node = chart;
    let best = '';
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (text && text.length < 900) best = text;
      if (/(deepseek-v4-(?:flash|pro)|Cost\(CNY\)|Tokens|费用|缓存)/i.test(text)) break;
    }
    return best.slice(0, 500);
  }

  function echartsResponses() {
    const responses = [];
    const charts = [...document.querySelectorAll('[_echarts_instance_]')];
    charts.forEach((chart, index) => {
      try {
        const instance = window.echarts?.getInstanceByDom?.(chart);
        const option = instance?.getOption?.();
        if (!option?.series?.length) return;
        const context = chartContext(chart);
        responses.push({
          order: 10_000 + index,
          path: `/dom-chart/${encodeURIComponent(context || `chart-${index}`)}`,
          transport: 'echarts',
          capturedAt: new Date().toISOString(),
          body: option
        });
      } catch { /* inaccessible chart instance */ }
    });
    return { responses, chartCount: charts.length };
  }

  function tooltipTexts() {
    return [...document.querySelectorAll('.usage-cost-tooltip-body, div[style*="z-index: 9999999"], div[style*="pointer-events: none"]')]
      .map(element => clean(element.innerText || element.textContent || ''))
      .filter(text => /20\d{2}-\d{2}-\d{2}/.test(text));
  }

  async function hoverChartsForTooltips() {
    const captured = [];
    const charts = [...document.querySelectorAll('[_echarts_instance_]')];
    for (const chart of charts) {
      const target = chart.querySelector('canvas,svg') || chart;
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      for (const ratio of [0.98, 0.94, 0.88]) {
        const event = new MouseEvent('mousemove', {
          bubbles: true,
          clientX: rect.left + rect.width * ratio,
          clientY: rect.top + rect.height * 0.55,
          view: window
        });
        target.dispatchEvent(event);
        await sleep(80);
        captured.push(...tooltipTexts());
      }
    }
    return [...new Set(captured)].slice(-20);
  }

  function tooltipResponses(texts) {
    const responses = [];
    texts.forEach((text, index) => {
      const date = text.match(/20\d{2}-\d{2}-\d{2}/)?.[0] || null;
      const compact = text.replace(/\s+/g, ' ');
      const costRows = [...compact.matchAll(/deepseek-v4-(flash|pro)\s*¥?\s*([\d,.]+)/ig)];
      if (costRows.length) {
        responses.push({
          order: 20_000 + index,
          path: '/tooltip/cost',
          body: costRows.map(match => ({ date, model: `deepseek-v4-${match[1].toLowerCase()}`, cost: Number(match[2].replaceAll(',', '')) }))
        });
      }
      const model = compact.match(/deepseek-v4-(flash|pro)/i)?.[1]?.toLowerCase();
      if (model && /cache\s*hit/i.test(compact)) {
        const lines = text.split(/\n+/).map(clean).filter(Boolean);
        const values = lines.filter(line => /^[\d,]+$/.test(line)).map(line => Number(line.replaceAll(',', '')));
        if (values.length >= 4) {
          const [tokens, cacheHitTokens, cacheMissTokens, outputTokens] = values.slice(-4);
          responses.push({
            order: 30_000 + index,
            path: '/tooltip/tokens',
            body: { date, model: `deepseek-v4-${model}`, tokens, cacheHitTokens, cacheMissTokens, outputTokens }
          });
        }
      }
    });
    return responses;
  }


  const VOLCENGINE_WINDOWS = [
    { id: '5h', label: '近5小时用量' },
    { id: 'weekly', label: '近一周用量' },
    { id: 'monthly', label: '近一月用量' }
  ];

  function scaledNumber(value) {
    const text = String(value ?? '').replaceAll(',', '').trim();
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    let parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) return null;
    if (/亿/.test(text)) parsed *= 100000000;
    else if (/万/.test(text)) parsed *= 10000;
    return parsed;
  }

  function exactVisibleElement(label) {
    return [...document.querySelectorAll('span,div,p,strong,label,h1,h2,h3,h4')]
      .find(element => clean(element.textContent) === label);
  }

  function usageCard(label) {
    const labelElement = exactVisibleElement(label);
    if (!labelElement) return null;
    let node = labelElement;
    let best = null;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (!text.includes(label) || text.length > 2200) continue;
      best = node;
      if (node.querySelector('[aria-valuenow], [role="progressbar"], [title]')) return node;
    }
    return best;
  }

  function resetFromText(text) {
    const line = String(text || '').split(/\n+/).map(clean)
      .find(value => /(?:后重置|后刷新|重置于|下次重置)/.test(value));
    if (line) return line.slice(0, 80);
    const match = String(text || '').match(/([^\n]{0,60}(?:后重置|后刷新|重置于|下次重置)[^\n]{0,20})/);
    return match ? clean(match[1]) : null;
  }

  function collectVolcengineWindow(definition) {
    const card = usageCard(definition.label);
    if (!card) return null;
    const text = card.innerText || card.textContent || '';
    const progress = card.querySelector('[aria-valuenow]');
    let usedPercent = numeric(progress?.getAttribute('aria-valuenow'));
    const ratio = text.match(/([\d,.]+(?:\.\d+)?\s*(?:万|亿)?)\s*(?:AFP)?\s*[/／]\s*([\d,.]+(?:\.\d+)?\s*(?:万|亿)?)/i);
    let used = ratio ? scaledNumber(ratio[1]) : null;
    let total = ratio ? scaledNumber(ratio[2]) : null;

    if (total == null) {
      const titled = [...card.querySelectorAll('[title]')]
        .map(element => scaledNumber(element.getAttribute('title')))
        .filter(value => value != null && value > 0);
      if (titled.length) total = Math.max(...titled);
    }
    if (usedPercent == null) {
      const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
      usedPercent = percentMatch ? Number(percentMatch[1]) : null;
    }
    if (used == null && total != null && usedPercent != null) used = total * usedPercent / 100;
    if (usedPercent == null && used != null && total) usedPercent = used / total * 100;

    return {
      id: definition.id,
      label: definition.label,
      used,
      total,
      usedPercent,
      remainingPercent: usedPercent == null ? null : Math.max(0, 100 - usedPercent),
      resetText: resetFromText(text)
    };
  }

  function volcengineUsageReady() {
    const body = document.body?.innerText || '';
    return VOLCENGINE_WINDOWS.every(item => body.includes(item.label));
  }

  function collectVolcengine() {
    const windows = VOLCENGINE_WINDOWS.map(collectVolcengineWindow).filter(Boolean);
    return {
      source,
      capturedAt: new Date().toISOString(),
      updateIntervalMinutes: 10,
      plan: 'Agent Plan 企业版',
      unit: 'AFP',
      windows,
      url: location.href,
      diagnostics: {
        primarySource: windows.length ? 'enterprise-usage-view' : 'waiting-for-enterprise-usage-view',
        instruction: windows.length ? null : '进入 Agent Plan 企业版的“用量统计”，看到三张 AFP 用量卡后点击“同步至 Kindle”',
        quotaCount: windows.length,
        usageViewReady: volcengineUsageReady()
      }
    };
  }

  async function collectDeepSeek() {
    await sleep(350);
    const balance = cardMetric(['balance', '余额'], money);
    const rangeCost = cardMetric(['cost', '费用', '消耗'], money);
    const rangeTokens = cardMetric(['tokens', 'token'], numeric);
    const rangeRequests = cardMetric(['api requests', '请求'], numeric);

    const networkResponses = [...(window.__TOKEN_ON_KINDLE_DEEPSEEK_RESPONSES__ || [])];
    const chart = echartsResponses();
    let combined = [...networkResponses, ...chart.responses];
    let parsed = window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__?.(combined, new Date()) || null;

    const needsTooltip = !parsed || [parsed.models?.flash?.tokens, parsed.models?.pro?.tokens, parsed.models?.flash?.cost, parsed.models?.pro?.cost].some(value => value == null);
    let tooltips = [];
    if (needsTooltip) {
      tooltips = await hoverChartsForTooltips();
      combined = [...combined, ...tooltipResponses(tooltips)];
      parsed = window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__?.(combined, new Date()) || parsed;
    }

    const flash = parsed?.models?.flash || null;
    const pro = parsed?.models?.pro || null;
    return {
      source,
      capturedAt: new Date().toISOString(),
      updateIntervalMinutes: 10,
      url: location.href,
      balance: balance ? { value: balance.value, currency: 'CNY' } : null,
      date: parsed?.date || null,
      todayCost: parsed?.todayCost == null ? null : { value: parsed.todayCost, currency: 'CNY' },
      todayTokens: parsed?.todayTokens == null ? null : { value: parsed.todayTokens },
      cacheRate: parsed?.cacheRate == null ? null : { value: parsed.cacheRate },
      models: { flash, pro },
      range: {
        cost: rangeCost?.value ?? null,
        tokens: rangeTokens?.value ?? null,
        requests: rangeRequests?.value ?? null
      },
      diagnostics: {
        captureInstalled: Boolean(window.__TOKEN_ON_KINDLE_CAPTURE_INSTALLED__),
        networkResponseCount: networkResponses.length,
        chartCount: chart.chartCount,
        tooltipCount: tooltips.length,
        parser: parsed?.diagnostics || null
      }
    };
  }

  let collecting = false;
  async function collectAndSignal() {
    if (collecting) return;
    collecting = true;
    try {
      if (source === 'volcengine' && !volcengineUsageReady()) {
        setToolbarStatus('请进入企业版 Agent Plan → 用量统计');
        return;
      }
      const payload = source === 'codex' ? collectCodex() : source === 'deepseek' ? await collectDeepSeek() : collectVolcengine();
      signal(payload);
    } finally {
      collecting = false;
    }
  }

  function setToolbarStatus(message, state = '') {
    const note = document.querySelector('#__token_on_kindle_status');
    if (!note) return;
    note.textContent = message;
    note.dataset.state = state;
  }

  function toolbar() {
    if (document.getElementById('__token_on_kindle_toolbar')) return;
    const root = document.createElement('div');
    root.id = '__token_on_kindle_toolbar';
    root.style.cssText = 'position:fixed;z-index:2147483647;right:14px;bottom:14px;padding:9px;background:white;color:black;border:2px solid black;border-radius:9px;font:13px sans-serif;display:grid;grid-template-columns:auto auto;gap:6px;box-shadow:0 4px 14px rgba(0,0,0,.18)';
    const sync = document.createElement('button');
    sync.textContent = '同步至 Kindle';
    sync.style.cssText = 'padding:7px 11px;border:1px solid #111;background:#111;color:#fff;border-radius:6px;font-weight:700';
    sync.onclick = () => collectAndSignal({ manual: true });
    const hide = document.createElement('button');
    hide.textContent = '隐藏窗口';
    hide.style.cssText = 'padding:7px 9px;border:1px solid #777;background:#fff;color:#111;border-radius:6px';
    hide.onclick = () => { document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard'; };
    const note = document.createElement('span');
    note.id = '__token_on_kindle_status';
    note.style.cssText = 'grid-column:1/-1;max-width:290px;color:#555;font-size:11px;line-height:1.35';
    note.textContent = source === 'volcengine' ? '进入企业版“用量统计”后点击同步' : '登录并打开用量页面后点击同步';
    root.append(sync, hide, note);
    document.documentElement.appendChild(root);
  }

  const originalCollectAndSignal = collectAndSignal;
  collectAndSignal = async function(options = {}) {
    toolbar();
    setToolbarStatus('正在读取当前页面…');
    try {
      await originalCollectAndSignal();
      if (source === 'volcengine' && !volcengineUsageReady()) return;
      sessionStorage.setItem('__token_on_kindle_synced_view', location.href);
      setToolbarStatus(options.manual ? '已同步至 Kindle' : '后台同步完成', 'success');
    } catch (error) {
      setToolbarStatus('同步失败：' + String(error?.message || error).slice(0, 80), 'error');
      console.error('[Token on Kindle] collection failed', error);
    }
  };
  window.__TOKEN_ON_KINDLE_SYNC__ = collectAndSignal;

  let autoCapturedView = '';
  const observer = new MutationObserver(() => {
    toolbar();
    if (source !== 'volcengine' || !volcengineUsageReady()) return;
    const marker = location.href + '|' + (document.body?.innerText?.length || 0);
    if (marker === autoCapturedView) return;
    autoCapturedView = marker;
    setToolbarStatus('已识别企业版 AFP 用量视图，可点击同步');
    setTimeout(() => collectAndSignal({ automatic: true }), 900);
  });

  function start() {
    toolbar();
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (source !== 'volcengine') {
      setTimeout(() => collectAndSignal({ automatic: true }), 2500);
      setTimeout(() => collectAndSignal({ automatic: true }), 7000);
    } else if (volcengineUsageReady()) {
      setTimeout(() => collectAndSignal({ automatic: true }), 1200);
    }
    setInterval(() => collectAndSignal({ automatic: true }), UPDATE_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
