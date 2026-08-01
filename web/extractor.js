(() => {
  'use strict';
  if (window.__TOKEN_ON_KINDLE_INSTALLED__) return;
  window.__TOKEN_ON_KINDLE_INSTALLED__ = true;

  const host = location.hostname;
  const source = host === 'chatgpt.com' ? 'codex' : host.endsWith('deepseek.com') ? 'deepseek' : null;
  if (!source) return;

  const UPDATE_MS = 10 * 60 * 1000;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const number = value => {
    const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const money = value => {
    const match = String(value ?? '').replaceAll(',', '').match(/(?:¥|￥|\$|CNY|RMB|USD)\s*(-?\d+(?:\.\d+)?)/i)
      || String(value ?? '').replaceAll(',', '').match(/(-?\d+(?:\.\d+)?)\s*(?:元|美元)/i);
    return match ? Number(match[1]) : null;
  };
  const integer = value => {
    const match = String(value ?? '').replaceAll(',', '').match(/\d+/);
    return match ? Number(match[0]) : null;
  };
  const pageLines = () => clean(document.body?.innerText || '').split(/\n+/).map(clean).filter(Boolean);
  const datePattern = /20\d{2}-\d{2}-\d{2}/;

  function signal(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const pageTitle = document.title;
    document.title = `__TOKEN_ON_KINDLE__:${source}:${encoded}`;
    setTimeout(() => {
      document.title = pageTitle || (source === 'codex' ? 'Codex Analytics' : 'DeepSeek Platform');
    }, 250);
  }

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
    return {
      id: quotaKind(context),
      displayedPercent: value,
      remainingPercent,
      usedPercent,
      resetText: resetText(context)
    };
  }

  function collectCodex() {
    const found = [];
    document.querySelectorAll('[role="progressbar"], [aria-valuenow], [aria-valuetext]').forEach(element => {
      const own = clean(element.getAttribute('aria-valuetext') || element.getAttribute('aria-valuenow') || element.textContent || '');
      const value = number(own);
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
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/(\d+(?:\.\d+)?)\s*%/);
      if (!match) continue;
      const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(' | ');
      const quota = quotaFrom(Number(match[1]), context);
      if (quota) found.push(quota);
    }

    const seen = new Set();
    const quotas = found.filter(item => {
      const key = `${item.id}|${item.displayedPercent}|${item.resetText || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.id === 'weekly' ? -1 : b.id === 'weekly' ? 1 : 0);

    return {
      source,
      capturedAt: new Date().toISOString(),
      updateIntervalMinutes: 10,
      quotas,
      url: location.href
    };
  }

  function exactTextElement(value, root = document) {
    return [...root.querySelectorAll('span,div')].find(element => clean(element.textContent).toLowerCase() === value.toLowerCase());
  }

  function cardMetric(labels) {
    const cards = [...document.querySelectorAll('[data-usage-layout-card="true"]')];
    for (const card of cards) {
      const text = clean(card.innerText || card.textContent || '');
      if (!labels.some(label => text.toLowerCase().includes(label.toLowerCase()))) continue;
      const valueElement = card.querySelector('[data-usage-layout-font="value"]');
      const raw = clean(valueElement?.textContent || text);
      return { value: money(raw) ?? integer(raw), raw };
    }
    return null;
  }

  function modelSection(modelName) {
    const heading = exactTextElement(modelName);
    if (!heading) return null;
    let node = heading.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      if (node.querySelectorAll('[_echarts_instance_]').length >= 2) return node;
    }
    return heading.parentElement;
  }

  function chartNearLabel(root, label) {
    const labelElement = exactTextElement(label, root);
    if (labelElement) {
      let node = labelElement.parentElement;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const chart = node.querySelector('[_echarts_instance_]');
        if (chart) return chart;
      }
    }
    const charts = root ? [...root.querySelectorAll('[_echarts_instance_]')] : [];
    return label.toLowerCase().includes('token') ? charts[1] : charts[0];
  }

  function dataValue(item) {
    const raw = item && typeof item === 'object' && 'value' in item ? item.value : item;
    if (Array.isArray(raw)) return Number(raw.at(-1)) || 0;
    return Number(raw) || 0;
  }

  function latestChartOption(chart) {
    try {
      const instance = window.echarts?.getInstanceByDom?.(chart);
      const option = instance?.getOption?.();
      if (!option?.series?.length) return null;
      const axis = option.xAxis?.[0]?.data || [];
      let index = Math.max(0, axis.length - 1);
      while (index > 0 && option.series.every(series => dataValue(series.data?.[index]) === 0)) index -= 1;
      return {
        date: clean(axis[index] || ''),
        series: option.series.map(series => ({ name: clean(series.name || ''), value: dataValue(series.data?.[index]) }))
      };
    } catch {
      return null;
    }
  }

  function tooltipCandidates() {
    return [...document.querySelectorAll('div[style*="z-index: 9999999"], .usage-cost-tooltip-body')]
      .map(element => clean(element.innerText || element.textContent || ''))
      .filter(text => datePattern.test(text));
  }

  async function latestTooltip(chart, requiredText) {
    if (!chart) return null;
    const target = chart.querySelector('canvas,svg') || chart;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    for (const offset of [7, 14, 24]) {
      const options = { bubbles: true, clientX: rect.right - offset, clientY: rect.top + rect.height * 0.55, view: window };
      target.dispatchEvent(new MouseEvent('mousemove', options));
      target.dispatchEvent(new MouseEvent('mouseover', options));
      await sleep(90);
      const texts = tooltipCandidates();
      const matched = texts.find(text => requiredText.some(value => text.toLowerCase().includes(value.toLowerCase())));
      if (matched) return matched;
    }
    return null;
  }

  function parseCostSeries(option) {
    if (!option) return null;
    const models = {};
    for (const series of option.series) {
      const name = series.name.toLowerCase();
      if (name.includes('flash')) models.flash = series.value;
      if (name.includes('pro')) models.pro = series.value;
    }
    if (!Object.keys(models).length) return null;
    return { date: option.date, total: Object.values(models).reduce((sum, value) => sum + value, 0), models };
  }

  function parseCostTooltip(text) {
    if (!text) return null;
    const compact = text.replace(/\s+/g, ' ');
    const date = compact.match(datePattern)?.[0] || null;
    const flash = compact.match(/deepseek-v4-flash\s*¥?\s*([\d,.]+)/i);
    const pro = compact.match(/deepseek-v4-pro\s*¥?\s*([\d,.]+)/i);
    const firstAmount = compact.match(/20\d{2}-\d{2}-\d{2}\s*¥\s*([\d,.]+)/);
    const models = {};
    if (flash) models.flash = Number(flash[1].replaceAll(',', ''));
    if (pro) models.pro = Number(pro[1].replaceAll(',', ''));
    if (!Object.keys(models).length) return null;
    return {
      date,
      total: firstAmount ? Number(firstAmount[1].replaceAll(',', '')) : Object.values(models).reduce((sum, value) => sum + value, 0),
      models
    };
  }

  function parseTokenSeries(option) {
    if (!option) return null;
    let cacheHit = 0;
    let cacheMiss = 0;
    let output = 0;
    for (const series of option.series) {
      const name = series.name.toLowerCase();
      if (name.includes('cache hit')) cacheHit += series.value;
      else if (name.includes('cache miss')) cacheMiss += series.value;
      else if (name.includes('output')) output += series.value;
    }
    const total = cacheHit + cacheMiss + output;
    if (!total) return null;
    return {
      date: option.date,
      total,
      cacheHit,
      cacheMiss,
      output,
      cacheRate: cacheHit + cacheMiss > 0 ? cacheHit / (cacheHit + cacheMiss) * 100 : null
    };
  }

  function parseTokenTooltip(text) {
    if (!text || !/cache hit/i.test(text)) return null;
    const lines = text.split(/\n+/).map(clean).filter(Boolean);
    const date = lines.find(line => datePattern.test(line))?.match(datePattern)?.[0] || null;
    const numeric = lines
      .filter(line => /^[\d,]+$/.test(line))
      .map(line => Number(line.replaceAll(',', '')))
      .filter(Number.isFinite);
    if (numeric.length < 4) return null;
    const [total, cacheHit, cacheMiss, output] = numeric.slice(-4);
    return {
      date,
      total: total || cacheHit + cacheMiss + output,
      cacheHit,
      cacheMiss,
      output,
      cacheRate: cacheHit + cacheMiss > 0 ? cacheHit / (cacheHit + cacheMiss) * 100 : null
    };
  }

  async function modelDay(modelName) {
    const section = modelSection(modelName);
    if (!section) return null;
    const tokenChart = chartNearLabel(section, 'Tokens');
    const option = parseTokenSeries(latestChartOption(tokenChart));
    const tooltip = option ? null : await latestTooltip(tokenChart, ['cache hit', 'cache miss', 'output']);
    const parsed = option || parseTokenTooltip(tooltip);

    const sectionText = clean(section.innerText || section.textContent || '');
    const rangeTokensMatch = sectionText.match(/Tokens\s*([\d,]+)/i);
    const requestsMatch = sectionText.match(/API requests\s*([\d,]+)/i);
    return {
      name: modelName,
      date: parsed?.date || null,
      tokens: parsed?.total ?? null,
      cacheHitTokens: parsed?.cacheHit ?? null,
      cacheMissTokens: parsed?.cacheMiss ?? null,
      outputTokens: parsed?.output ?? null,
      cacheRate: parsed?.cacheRate ?? null,
      rangeTokens: rangeTokensMatch ? Number(rangeTokensMatch[1].replaceAll(',', '')) : null,
      rangeRequests: requestsMatch ? Number(requestsMatch[1].replaceAll(',', '')) : null
    };
  }

  async function collectDeepSeek() {
    const balanceCard = cardMetric(['balance', '余额']);
    const rangeCost = cardMetric(['cost', '费用', '消耗']);
    const rangeTokens = cardMetric(['tokens', 'token']);
    const rangeRequests = cardMetric(['api requests', '请求']);

    const usageBoard = document.querySelector('#usage-board') || document;
    const costChart = chartNearLabel(usageBoard, 'Cost(CNY)') || usageBoard.querySelector('[_echarts_instance_]');
    let costDay = parseCostSeries(latestChartOption(costChart));
    if (!costDay) {
      const tooltip = await latestTooltip(costChart, ['deepseek-v4-flash', 'deepseek-v4-pro']);
      costDay = parseCostTooltip(tooltip);
    }

    const [flash, pro] = await Promise.all([
      modelDay('deepseek-v4-flash'),
      modelDay('deepseek-v4-pro')
    ]);
    if (flash) flash.cost = costDay?.models?.flash ?? null;
    if (pro) pro.cost = costDay?.models?.pro ?? null;

    const models = { flash, pro };
    const modelList = [flash, pro].filter(Boolean);
    const todayTokens = modelList.some(model => model.tokens != null)
      ? modelList.reduce((sum, model) => sum + (model.tokens || 0), 0)
      : null;
    const totalInput = modelList.reduce((sum, model) => sum + (model.cacheHitTokens || 0) + (model.cacheMissTokens || 0), 0);
    const totalHit = modelList.reduce((sum, model) => sum + (model.cacheHitTokens || 0), 0);

    return {
      source,
      capturedAt: new Date().toISOString(),
      updateIntervalMinutes: 10,
      date: costDay?.date || flash?.date || pro?.date || null,
      balance: balanceCard?.value != null ? { value: balanceCard.value, currency: 'CNY' } : null,
      todayCost: costDay?.total != null ? { value: costDay.total, currency: 'CNY' } : null,
      todayTokens: todayTokens != null ? { value: todayTokens } : null,
      cacheRate: totalInput > 0 ? { value: totalHit / totalInput * 100 } : null,
      models,
      range: {
        cost: rangeCost?.value ?? null,
        tokens: rangeTokens?.value ?? null,
        requests: rangeRequests?.value ?? null
      },
      url: location.href
    };
  }

  let collecting = false;
  async function collect() {
    if (collecting) return;
    collecting = true;
    try {
      const payload = source === 'codex' ? collectCodex() : await collectDeepSeek();
      signal(payload);
    } catch (error) {
      console.error('[Token on Kindle] collection failed', error);
    } finally {
      collecting = false;
    }
  }

  function toolbar() {
    if (document.getElementById('__token_on_kindle_toolbar')) return;
    const root = document.createElement('div');
    root.id = '__token_on_kindle_toolbar';
    root.style.cssText = 'position:fixed;z-index:2147483647;right:14px;bottom:14px;padding:8px;background:white;color:black;border:2px solid black;font:13px sans-serif;display:flex;align-items:center;gap:7px';
    const update = document.createElement('button');
    update.textContent = '立即更新';
    update.onclick = () => location.reload();
    const back = document.createElement('button');
    back.textContent = '隐藏窗口';
    back.onclick = () => { document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard'; };
    const note = document.createElement('span');
    note.textContent = '后台每 10 分钟刷新';
    root.append(update, back, note);
    document.documentElement.appendChild(root);
  }

  let boardSeen = false;
  const observer = new MutationObserver(() => {
    toolbar();
    const ready = source === 'codex'
      ? /%/.test(document.body?.innerText || '')
      : Boolean(document.querySelector('#usage-board'));
    if (ready && !boardSeen) {
      boardSeen = true;
      setTimeout(collect, 1800);
    }
  });

  const start = () => {
    toolbar();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(collect, 4200);
    setInterval(() => location.reload(), UPDATE_MS);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
