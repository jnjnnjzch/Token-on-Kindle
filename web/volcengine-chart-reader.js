(() => {
  'use strict';
  if (!location.hostname.endsWith('volcengine.com') || window.__TOKEN_ON_KINDLE_VOLCENGINE_CHART_READER__) return;
  window.__TOKEN_ON_KINDLE_VOLCENGINE_CHART_READER__ = true;

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const numeric = value => {
    const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const scaledNumber = value => {
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
  const MAX_CACHED_CHART_AGE_MS = 90_000;

  const state = {
    section: null,
    chart: null,
    cards: new Map(),
    lastGoodChart: null,
    lastGoodAt: 0,
    collecting: false,
    retryTimer: null,
    lastHref: location.href
  };

  function exactVisibleElement(label, root = document) {
    return [...root.querySelectorAll('h1,h2,h3,h4,strong,label,span,p,div')]
      .find(element => clean(element.textContent) === label) || null;
  }

  function sectionRoot() {
    if (state.section?.isConnected && clean(state.section.textContent).includes('模型调用明细')) {
      return state.section;
    }
    const title = exactVisibleElement('模型调用明细');
    if (!title) return null;
    let node = title;
    let best = title.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (!text.includes('模型调用明细') || text.length > 30_000) continue;
      best = node;
      if (node.querySelector('.echarts-for-react[_echarts_instance_], [_echarts_instance_]')) break;
    }
    state.section = best;
    return best;
  }

  function legendNames(root) {
    if (!root) return [];
    const names = [...root.querySelectorAll('[class*="legendItem"][title], [class*="legendBox"] [title]')]
      .map(element => clean(element.getAttribute('title'))).filter(Boolean);
    if (!names.length) {
      names.push(...[...root.querySelectorAll('[class*="legendName"]')]
        .map(element => clean(element.textContent)).filter(Boolean));
    }
    return [...new Map(names.map(name => [name.toLowerCase(), name])).values()];
  }

  function chartElement(root) {
    if (state.chart?.isConnected && root?.contains(state.chart)) return state.chart;
    state.chart = root?.querySelector('.echarts-for-react[_echarts_instance_], [_echarts_instance_]') || null;
    return state.chart;
  }

  function chartOption(chart) {
    return window.__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__?.(chart, window.echarts) || null;
  }

  function cachedChartFallback(diagnostics, dates, granularity) {
    const cacheAgeMs = state.lastGoodAt ? Date.now() - state.lastGoodAt : Number.POSITIVE_INFINITY;
    if (!state.lastGoodChart || cacheAgeMs > MAX_CACHED_CHART_AGE_MS) {
      state.lastGoodChart = null;
      state.lastGoodAt = 0;
      return {
        models: [],
        periodStart: dates[0] || null,
        periodEnd: dates[1] || null,
        granularity: granularity || null,
        source: 'none',
        diagnostics
      };
    }
    return {
      ...state.lastGoodChart,
      source: `${state.lastGoodChart.source}-cached`,
      diagnostics: {
        ...diagnostics,
        cached: true,
        cachedFrom: state.lastGoodChart.source,
        cacheAgeMs,
        parser: state.lastGoodChart.diagnostics?.parser || null
      }
    };
  }

  function readModelChart() {
    const root = sectionRoot();
    const chart = chartElement(root);
    const names = legendNames(root);
    const dates = root ? [...root.querySelectorAll('input[placeholder="开始日期"], input[placeholder="结束日期"]')]
      .map(input => clean(input.value)).filter(Boolean) : [];
    const granularity = root ? [...root.querySelectorAll('[class*="granularityTabActive"]')]
      .map(element => clean(element.textContent)).find(value => value === '天' || value === '小时') : null;
    const diagnostics = {
      chartCount: chart ? 1 : 0,
      legendNames: names,
      periodStart: dates[0] || null,
      periodEnd: dates[1] || null,
      granularity: granularity || null,
      accessMethod: null,
      chartInstanceId: chart?.getAttribute('_echarts_instance_') || null,
      parser: null,
      cached: false
    };

    if (!chart) return cachedChartFallback(diagnostics, dates, granularity);
    const access = chartOption(chart);
    if (!access?.option) return cachedChartFallback(diagnostics, dates, granularity);
    const parsed = window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__?.(
      access.option,
      names,
      { periodStart: dates[0] || null, periodEnd: dates[1] || null, granularity: granularity || null }
    );
    diagnostics.accessMethod = access.method;
    diagnostics.parser = parsed?.diagnostics || null;
    if (!parsed?.diagnostics?.pointCount || !parsed.models?.length) {
      return cachedChartFallback(diagnostics, dates, granularity);
    }

    const result = {
      models: parsed.models,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      granularity: parsed.granularity,
      source: access.method,
      diagnostics
    };
    state.lastGoodChart = result;
    state.lastGoodAt = Date.now();
    return result;
  }

  const WINDOWS = [
    { id: '5h', label: '近5小时用量' },
    { id: 'weekly', label: '近一周用量' },
    { id: 'monthly', label: '近一月用量' }
  ];

  function usageCard(label) {
    const cached = state.cards.get(label);
    if (cached?.isConnected && clean(cached.textContent).includes(label)) return cached;
    const labelElement = exactVisibleElement(label);
    if (!labelElement) return null;
    let node = labelElement;
    let best = null;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (!text.includes(label) || text.length > 2200) continue;
      best = node;
      if (node.querySelector('[aria-valuenow], [role="progressbar"], [title]')) break;
    }
    if (best) state.cards.set(label, best);
    return best;
  }

  function resetText(text) {
    const line = String(text || '').split(/\n+/).map(clean)
      .find(value => /(?:后重置|后刷新|重置于|下次重置)/.test(value));
    return line ? line.slice(0, 80) : null;
  }

  function collectWindow(definition) {
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
      const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
      usedPercent = match ? Number(match[1]) : null;
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
      resetText: resetText(text)
    };
  }

  function applySyncOptions(options = {}) {
    const refreshMinutes = numeric(options.refreshMinutes ?? options.refresh_minutes);
    if (refreshMinutes != null) sessionStorage.setItem('__token_on_kindle_refresh_minutes', String(refreshMinutes));
    if (options.syncRequestedAt) sessionStorage.setItem('__token_on_kindle_sync_requested_at', String(options.syncRequestedAt));
  }

  function encodeSignal(payload) {
    const refreshMinutes = numeric(sessionStorage.getItem('__token_on_kindle_refresh_minutes'));
    const syncRequestedAt = sessionStorage.getItem('__token_on_kindle_sync_requested_at') || null;
    const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt }));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  function signal(payload) {
    const title = document.title;
    document.title = `__TOKEN_ON_KINDLE__:volcengine:${encodeSignal(payload)}`;
    setTimeout(() => { document.title = title || '火山方舟 Agent Plan 企业版'; }, 250);
  }

  function toolbarStatus(message, stateName = '') {
    const note = document.querySelector('#__token_on_kindle_status');
    if (!note) return;
    note.textContent = message;
    note.dataset.state = stateName;
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

function triggerDataRefresh() {
  const roots = [sectionRoot(), document].filter(Boolean);
  const seen = new Set();
  for (const root of roots) {
    for (const control of root.querySelectorAll('button,[role="button"]')) {
      if (seen.has(control) || control.disabled || control.getAttribute('aria-disabled') === 'true') continue;
      seen.add(control);
        if (!control.isConnected) continue;
      const label = controlText(control);
      if (!/^(查询|刷新|搜索|更新|query|refresh|search|update)$/i.test(label)) continue;
      if (!/(模型调用明细|用量统计|AFP|开始日期|结束日期)/.test(controlContext(control))) continue;
      try {
        control.click();
        return label;
      } catch { /* fall through to the next matching control */ }
    }
  }
  return null;
}

  function scheduleRetry(options, delay = 1200) {
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      collectAndSignal({ ...options, retry: true }).catch(() => {});
    }, delay);
  }

  async function collectAndSignal(options = {}) {
    if (state.collecting) return null;
    state.collecting = true;
    applySyncOptions(options);
    try {
      let refreshAction = null;
      if (!options.retry && (options.manual || options.automatic)) {
        refreshAction = triggerDataRefresh();
      }
      if (refreshAction) {
        resetDomCache(true);
        await sleep(900);
      } else {
        await sleep(40);
      }
      const windows = WINDOWS.map(collectWindow).filter(Boolean);
      if (windows.length !== WINDOWS.length) {
        toolbarStatus('等待企业版 AFP 用量页面就绪', 'warning');
        if (!options.retry && (options.manual || options.automatic)) scheduleRetry(options, 1400);
        return null;
      }
      const chart = readModelChart();
      const payload = {
        source: 'volcengine',
        capturedAt: new Date().toISOString(),
        plan: 'Agent Plan 企业版',
        unit: 'AFP',
        windows,
        models: chart.models,
        modelUsage: {
          source: chart.source,
          periodStart: chart.periodStart,
          periodEnd: chart.periodEnd,
          granularity: chart.granularity
        },
        url: location.href,
        diagnostics: {
          primarySource: 'enterprise-usage-view',
          quotaCount: windows.length,
          usageViewReady: true,
          modelUsageSource: chart.source,
          modelCount: chart.models.length,
          modelChart: chart.diagnostics,
          refreshAction
        }
      };
      signal(payload);
      toolbarStatus(
        chart.models.length ? `已同步 AFP 与 ${chart.models.length} 个模型` : '已同步 AFP；模型图表尚未就绪',
        chart.models.length ? 'success' : 'warning'
      );
      if (!chart.models.length && !options.retry) scheduleRetry(options, 1400);
      return payload;
    } finally {
      state.collecting = false;
    }
  }

  async function directSync(options = {}) {
    return collectAndSignal(options);
  }

  function installSyncOverride() {
    window.__TOKEN_ON_KINDLE_SYNC__ = directSync;
    const button = [...document.querySelectorAll('#__token_on_kindle_toolbar button')]
      .find(element => clean(element.textContent) === '同步至 Kindle');
    if (button && button.dataset.directChartReader !== 'true') {
      button.dataset.directChartReader = 'true';
      button.onclick = () => directSync({ manual: true });
    }
  }

  function resetDomCache(clearLastGood = false) {
    state.section = null;
    state.chart = null;
    state.cards.clear();
    if (clearLastGood) {
      state.lastGoodChart = null;
      state.lastGoodAt = 0;
    }
  }

  function start() {
    installSyncOverride();
    for (const delay of [1200, 3200, 6500]) {
      setTimeout(() => {
        installSyncOverride();
        collectAndSignal({ automatic: true, startup: true }).catch(() => {});
      }, delay);
    }
  }

  window.addEventListener('pageshow', () => {
    resetDomCache(true);
    installSyncOverride();
    scheduleRetry({ automatic: true, pageshow: true }, 500);
  });
  window.addEventListener('popstate', () => {
    if (location.href === state.lastHref) return;
    state.lastHref = location.href;
    resetDomCache(true);
    scheduleRetry({ automatic: true, navigation: true }, 700);
  });
  window.addEventListener('hashchange', () => {
    state.lastHref = location.href;
    resetDomCache(true);
    scheduleRetry({ automatic: true, navigation: true }, 700);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    installSyncOverride();
    scheduleRetry({ automatic: true, visible: true }, 500);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
