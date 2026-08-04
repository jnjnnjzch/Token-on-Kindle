(() => {
const DATE_RE = /20\d{2}[-/]\d{1,2}[-/]\d{1,2}/;
const MODEL_RE = /deepseek[-_ ]?v?4[-_ ]?(flash|pro)|(?:^|[-_ ])(flash|pro)(?:$|[-_ ])/i;

const cleanKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const finite = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const compact = String(value).replaceAll(',', '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(compact)) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
};

function cleanDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1e12 ? value * 1000 : value;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
  }
  const match = String(value ?? '').match(DATE_RE);
  if (!match) return null;
  const [year, month, day] = match[0].replaceAll('/', '-').split('-');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function modelFrom(value) {
  const match = String(value ?? '').match(MODEL_RE);
  return (match?.[1] || match?.[2] || '').toLowerCase() || null;
}

function metricFromKey(value) {
  const key = cleanKey(value);
  if (!key) return null;
  if (/(cachehit|promptcachehit|hitcache)/.test(key) && /(token|amount|count)/.test(key)) return 'cacheHitTokens';
  if (/(cachemiss|promptcachemiss|misscache)/.test(key) && /(token|amount|count)/.test(key)) return 'cacheMissTokens';
  if (/(output|completion|response)/.test(key) && /(token|amount|count)/.test(key)) return 'outputTokens';
  if (/(input|prompt)/.test(key) && /(token|amount|count)/.test(key) && !/cache/.test(key)) return 'inputTokens';
  if (/^(token|tokens|totaltoken|totaltokens|tokenamount|tokenusage|usedtoken|usedtokens)$/.test(key)) return 'tokens';
  if (/(cost|fee|charge|expense|consume|spend|amountcny|cnyamount|totalamount|billingamount)/.test(key) && !/(token|request)/.test(key)) return 'cost';
  if (/^(request|requests|requestcount|apirequest|apirequests|call|calls)$/.test(key)) return 'requests';
  return null;
}

function dateFromObject(object, fallback = null) {
  for (const [key, value] of Object.entries(object || {})) {
    if (/(date|day|time|timestamp|statdate|createdat|starttime|endtime)/i.test(key)) {
      const parsed = cleanDate(value);
      if (parsed) return parsed;
    }
  }
  return fallback;
}

function modelFromObject(object, fallback = null) {
  for (const [key, value] of Object.entries(object || {})) {
    if (/(model|modelname|model_name|name|product|sku|type|category)/i.test(key)) {
      const parsed = modelFrom(value);
      if (parsed) return parsed;
    }
  }
  return fallback;
}

function metricFromObject(object, fallback = null) {
  for (const [key, value] of Object.entries(object || {})) {
    if (/(metric|name|type|category|key|label|title)/i.test(key)) {
      const parsed = metricFromKey(value);
      if (parsed) return parsed;
    }
  }
  return fallback;
}

function addRecord(records, record) {
  if (!record.model || !record.metric || record.value == null || record.value < 0) return;
  records.push(record);
}

function walkRecords(value, records, context = {}, path = '$', depth = 0) {
  if (depth > 16 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkRecords(item, records, context, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;

  const date = dateFromObject(value, context.date);
  const model = modelFromObject(value, context.model) || modelFrom(path);
  const metric = metricFromObject(value, context.metric);

  for (const [key, child] of Object.entries(value)) {
    const keyModel = modelFrom(key) || model;
    const keyMetric = metricFromKey(key) || metric;
    const scalar = finite(child);
    if (scalar != null && keyModel && keyMetric) {
      addRecord(records, {
        model: keyModel,
        metric: keyMetric,
        value: scalar,
        date,
        path: `${path}.${key}`,
        order: context.order || 0,
        confidence: date ? 6 : 3
      });
    }
    if (child && typeof child === 'object') {
      walkRecords(child, records, {
        date,
        model: keyModel,
        metric: metricFromKey(key) || metric,
        order: context.order || 0
      }, `${path}.${key}`, depth + 1);
    }
  }
}

function findDateAxis(value, depth = 0) {
  if (depth > 4 || !value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    const dates = value.map(cleanDate);
    if (dates.length && dates.filter(Boolean).length >= Math.max(1, value.length * 0.6)) return dates;
    for (const item of value) {
      const found = findDateAxis(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const entries = Object.entries(value);
  entries.sort(([a], [b]) => Number(/(xaxis|date|day|category)/i.test(b)) - Number(/(xaxis|date|day|category)/i.test(a)));
  for (const [, child] of entries) {
    const found = findDateAxis(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function seriesValues(series) {
  if (Array.isArray(series)) return series;
  for (const key of ['data', 'values', 'value', 'points', 'items']) {
    if (Array.isArray(series?.[key])) return series[key];
  }
  return null;
}

function pointValue(point) {
  if (point && typeof point === 'object' && !Array.isArray(point)) {
    for (const key of ['value', 'y', 'amount', 'count']) {
      const parsed = finite(point[key]);
      if (parsed != null) return parsed;
    }
  }
  if (Array.isArray(point)) return finite(point.at(-1));
  return finite(point);
}

function metricFromContext(path, name) {
  const combined = `${path} ${name}`;
  return metricFromKey(combined)
    || (/cache\s*hit/i.test(combined) ? 'cacheHitTokens' : null)
    || (/cache\s*miss/i.test(combined) ? 'cacheMissTokens' : null)
    || (/(output|completion|response).*token/i.test(combined) ? 'outputTokens' : null)
    || (/(input|prompt).*token/i.test(combined) && !/cache/i.test(combined) ? 'inputTokens' : null)
    || (/(token|tokens)/i.test(combined) ? 'tokens' : null)
    || (/(cost|cny|fee|charge|expense|spend)/i.test(combined) ? 'cost' : null)
    || (/(request|calls)/i.test(combined) ? 'requests' : null);
}

function walkSeries(value, records, context = {}, path = '$', depth = 0) {
  if (depth > 14 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSeries(item, records, context, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;

  const dateAxis = findDateAxis(value);
  const collections = [];
  for (const [key, child] of Object.entries(value)) {
    if (!Array.isArray(child) || !child.length || !child.every(item => item && typeof item === 'object')) continue;
    if (child.some(item => seriesValues(item))) collections.push({ key, items: child });
  }

  for (const collection of collections) {
    for (const series of collection.items) {
      const name = String(series?.name ?? series?.seriesName ?? series?.label ?? series?.model ?? collection.key);
      const model = modelFrom(name) || modelFrom(path) || context.model;
      const metric = metricFromContext(`${path}.${collection.key}`, name) || context.metric;
      const values = seriesValues(series);
      if (!model || !metric || !values) continue;
      values.forEach((point, index) => {
        const parsed = pointValue(point);
        if (parsed == null) return;
        const date = cleanDate(point?.date || point?.name || point?.x) || dateAxis?.[index] || context.date || null;
        addRecord(records, {
          model,
          metric,
          value: parsed,
          date,
          path: `${path}.${collection.key}[${index}]`,
          order: context.order || 0,
          confidence: date ? 7 : 4
        });
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== 'object') continue;
    walkSeries(child, records, {
      date: dateFromObject(value, context.date),
      model: modelFrom(key) || modelFromObject(value, context.model) || context.model,
      metric: metricFromKey(key) || metricFromObject(value, context.metric) || context.metric,
      order: context.order || 0
    }, `${path}.${key}`, depth + 1);
  }
}

function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function choose(records, model, metric, wantedDate) {
  const matches = records.filter(item => item.model === model && item.metric === metric);
  if (!matches.length) return null;
  const exact = matches.filter(item => item.date === wantedDate);
  const dated = matches.filter(item => item.date).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const pool = exact.length ? exact : dated.length ? dated.filter(item => item.date === dated[0].date) : matches;
  return pool.sort((a, b) => b.order - a.order || b.confidence - a.confidence)[0] || null;
}

function modelResult(records, model, date) {
  const selected = {};
  for (const metric of ['tokens', 'inputTokens', 'cacheHitTokens', 'cacheMissTokens', 'outputTokens', 'cost', 'requests']) {
    selected[metric] = choose(records, model, metric, date);
  }
  const hit = selected.cacheHitTokens?.value ?? null;
  const miss = selected.cacheMissTokens?.value ?? null;
  const output = selected.outputTokens?.value ?? null;
  const input = selected.inputTokens?.value ?? null;
  let tokens = selected.tokens?.value ?? null;
  if (tokens == null && (hit != null || miss != null || output != null)) tokens = (hit || 0) + (miss || 0) + (output || 0);
  if (tokens == null && (input != null || output != null)) tokens = (input || 0) + (output || 0);
  return {
    name: `deepseek-v4-${model}`,
    date: selected.tokens?.date || selected.cost?.date || selected.cacheHitTokens?.date || selected.outputTokens?.date || null,
    tokens,
    cost: selected.cost?.value ?? null,
    cacheHitTokens: hit,
    cacheMissTokens: miss,
    outputTokens: output,
    cacheRate: hit != null && miss != null && hit + miss > 0 ? hit / (hit + miss) * 100 : null,
    requests: selected.requests?.value ?? null,
    evidence: Object.fromEntries(Object.entries(selected).filter(([, item]) => item).map(([metric, item]) => [metric, { date: item.date, path: item.path, order: item.order }]))
  };
}

function parseDeepSeekResponses(responses, now = new Date()) {
  const records = [];
  const matchedResponses = [];
  (responses || []).forEach((response, order) => {
    if (!response?.body || typeof response.body !== 'object') return;
    const path = response.path || response.url || '$';
    const before = records.length;
    const context = { model: modelFrom(path), metric: metricFromKey(path), date: cleanDate(path), order: response.order ?? order + 1 };
    walkRecords(response.body, records, context, path);
    walkSeries(response.body, records, context, path);
    const count = records.length - before;
    if (count) matchedResponses.push({ path, records: count });
  });

  const date = localDate(now);
  const models = {
    flash: modelResult(records, 'flash', date),
    pro: modelResult(records, 'pro', date)
  };
  const list = Object.values(models);
  const tokenValues = list.map(model => model.tokens).filter(value => value != null);
  const costValues = list.map(model => model.cost).filter(value => value != null);
  const totalHit = list.reduce((sum, model) => sum + (model.cacheHitTokens || 0), 0);
  const totalMiss = list.reduce((sum, model) => sum + (model.cacheMissTokens || 0), 0);

  return {
    date,
    models,
    todayTokens: tokenValues.length === 2 ? tokenValues.reduce((sum, value) => sum + value, 0) : null,
    todayCost: costValues.length === 2 ? costValues.reduce((sum, value) => sum + value, 0) : null,
    cacheRate: totalHit + totalMiss > 0 ? totalHit / (totalHit + totalMiss) * 100 : null,
    diagnostics: {
      responseCount: (responses || []).length,
      recordCount: records.length,
      matchedResponses: matchedResponses.slice(-20),
      responsePaths: [...new Set((responses || []).map(item => item.path || item.url).filter(Boolean))].slice(-30)
    }
  };
}

window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__ = parseDeepSeekResponses;
})();
(() => {
const cleanKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');

const finiteNumber = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).replaceAll(',', '').trim();
  const match = text.match(/^-?\d+(?:\.\d+)?(?:万|亿)?$/);
  if (!match) return null;
  const base = Number(text.replace(/[万亿]$/, ''));
  if (!Number.isFinite(base)) return null;
  return text.endsWith('亿') ? base * 100_000_000 : text.endsWith('万') ? base * 10_000 : base;
};

const MODEL_KEY = /^(model|modelname|modelid|foundationmodel|foundationmodelname|endpointmodel|sku|modeldisplayname)$/;
const GENERIC_MODEL_TEXT = /^(全部模型|all models?|模型|model|unknown|null|undefined|-|--)$/i;

function looksLikeModelName(value, path = '') {
  const text = String(value ?? '').trim();
  if (!text || text.length > 120 || GENERIC_MODEL_TEXT.test(text)) return false;
  if (/^20\d{2}[-/]\d{1,2}[-/]\d{1,2}/.test(text)) return false;
  if (/^[\d,.%/\s]+$/.test(text)) return false;
  if (/(doubao|deepseek|seed|kimi|qwen|glm|moonshot|minimax|vision|speech|embedding|rerank|豆包|模型)/i.test(text)) return true;
  return /(model|usage|detail|token|seat)/i.test(path) && /[A-Za-z\u4e00-\u9fff]/.test(text);
}

function metricFromKey(rawKey) {
  const key = cleanKey(rawKey);
  if (!key) return null;
  if (/(cachehit|cached|cachetoken)/.test(key) && /(token|amount|count|usage)/.test(key)) return 'cachedTokens';
  if (/(input|prompt|requestinput)/.test(key) && /(token|amount|count|usage)/.test(key) && !/cache/.test(key)) return 'inputTokens';
  if (/(output|completion|response)/.test(key) && /(token|amount|count|usage)/.test(key)) return 'outputTokens';
  if (/^(totaltokens?|tokenstotal|tokenusage|usedtokens?|tokens?|tokencount|total_token)$/.test(key)) return 'totalTokens';
  if (/(request|call)/.test(key) && /(count|total|times|number|num|usage|^requests?$|^calls?$)/.test(key)) return 'requests';
  if (/(afp|fuel)/.test(key) && /(usage|amount|count|used|consume|total|value)/.test(key)) return 'afp';
  return null;
}

function modelNameFromObject(object, path) {
  const entries = Object.entries(object || {});
  const preferred = entries.filter(([key]) => MODEL_KEY.test(cleanKey(key)));
  const fallback = entries.filter(([key]) => /(^|_)(name|displayname)$|名称$/i.test(key));
  for (const [key, value] of [...preferred, ...fallback]) {
    if ((typeof value === 'string' || typeof value === 'number') && looksLikeModelName(value, `${path}.${key}`)) {
      return String(value).trim();
    }
  }
  return null;
}

function collectMetrics(value, metrics, path = '$', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return;
  for (const [key, child] of Object.entries(value)) {
    const metric = metricFromKey(key);
    const number = finiteNumber(child);
    if (metric && number != null && number >= 0) {
      metrics[metric] = (metrics[metric] || 0) + number;
    } else if (child && typeof child === 'object') {
      collectMetrics(child, metrics, `${path}.${key}`, depth + 1);
    }
  }
}

function modelCandidate(object, path) {
  const name = modelNameFromObject(object, path);
  if (!name) return null;
  const metrics = {};
  collectMetrics(object, metrics, path);
  if (!Object.keys(metrics).length) return null;
  if (metrics.totalTokens == null && (metrics.inputTokens != null || metrics.outputTokens != null)) {
    metrics.totalTokens = (metrics.inputTokens || 0) + (metrics.outputTokens || 0);
  }
  if (metrics.totalTokens == null && metrics.cachedTokens != null) metrics.totalTokens = metrics.cachedTokens;
  return { name, ...metrics, evidencePath: path };
}

function walkCandidates(value, candidates, path = '$', depth = 0) {
  if (value == null || depth > 16) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkCandidates(item, candidates, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  const candidate = modelCandidate(value, path);
  if (candidate) candidates.push(candidate);
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') walkCandidates(child, candidates, `${path}.${key}`, depth + 1);
  }
}

function aggregateCandidates(candidates) {
  const byModel = new Map();
  const seen = new Set();
  for (const candidate of candidates) {
    const signature = `${candidate.evidencePath}|${candidate.name}|${candidate.totalTokens ?? ''}|${candidate.inputTokens ?? ''}|${candidate.outputTokens ?? ''}|${candidate.cachedTokens ?? ''}|${candidate.requests ?? ''}|${candidate.afp ?? ''}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const key = candidate.name.toLowerCase();
    const current = byModel.get(key) || {
      id: key.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, ''),
      name: candidate.name,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      requests: 0,
      afp: 0,
      evidencePaths: []
    };
    for (const metric of ['totalTokens', 'inputTokens', 'outputTokens', 'cachedTokens', 'requests', 'afp']) {
      if (candidate[metric] != null) current[metric] += candidate[metric];
    }
    current.evidencePaths.push(candidate.evidencePath);
    byModel.set(key, current);
  }
  return [...byModel.values()].map(model => {
    for (const metric of ['totalTokens', 'inputTokens', 'outputTokens', 'cachedTokens', 'requests', 'afp']) {
      if (!model[metric]) model[metric] = null;
    }
    if (model.totalTokens == null && (model.inputTokens != null || model.outputTokens != null)) {
      model.totalTokens = (model.inputTokens || 0) + (model.outputTokens || 0);
    }
    model.evidencePaths = model.evidencePaths.slice(0, 8);
    return model;
  }).sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0) || a.name.localeCompare(b.name));
}

function parseVolcengineModelUsageResponses(responses = []) {
  const ordered = [...responses]
    .filter(item => item?.body && typeof item.body === 'object')
    .sort((a, b) => (b.order || 0) - (a.order || 0));
  for (const response of ordered) {
    const candidates = [];
    walkCandidates(response.body, candidates, response.path || response.url || '$');
    const models = aggregateCandidates(candidates);
    if (models.length) {
      return {
        models,
        sourcePath: response.path || response.url || null,
        capturedAt: response.capturedAt || null,
        diagnostics: {
          responseCount: responses.length,
          candidateCount: candidates.length,
          selectedOrder: response.order || null,
          selectedPath: response.path || response.url || null
        }
      };
    }
  }
  return {
    models: [],
    sourcePath: null,
    capturedAt: null,
    diagnostics: { responseCount: responses.length, candidateCount: 0, selectedOrder: null, selectedPath: null }
  };
}

window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE__ = parseVolcengineModelUsageResponses;
})();
(() => {
  'use strict';
  if (window.__TOKEN_ON_KINDLE_INSTALLED__) return;
  window.__TOKEN_ON_KINDLE_INSTALLED__ = true;

  const host = location.hostname;
  const source = host === 'chatgpt.com' ? 'codex' : host.endsWith('deepseek.com') ? 'deepseek' : host.endsWith('volcengine.com') ? 'volcengine' : null;
  if (!source) return;

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

  const syncState = {
    refreshMinutes: numeric(sessionStorage.getItem('__token_on_kindle_refresh_minutes')),
    syncRequestedAt: sessionStorage.getItem('__token_on_kindle_sync_requested_at') || null
  };

  function applySyncOptions(options = {}) {
    const refreshMinutes = numeric(options.refreshMinutes);
    if (refreshMinutes != null) {
      syncState.refreshMinutes = refreshMinutes;
      sessionStorage.setItem('__token_on_kindle_refresh_minutes', String(refreshMinutes));
    }
    if (options.syncRequestedAt) {
      syncState.syncRequestedAt = String(options.syncRequestedAt);
      sessionStorage.setItem('__token_on_kindle_sync_requested_at', syncState.syncRequestedAt);
    }
  }

  window.addEventListener('beforeunload', () => {
    if (!document.hasFocus()) {
      try { window.close(); } catch { /* native window guard */ }
    }
  });

  function signal(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, updateIntervalMinutes: syncState.refreshMinutes, syncRequestedAt: syncState.syncRequestedAt }));
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

  function installVolcengineNetworkCapture() {
    if (source !== 'volcengine' || window.__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__) return;
    window.__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__ = true;
    const store = window.__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__ = window.__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__ || [];
    let order = store.at(-1)?.order || 0;

    const relevant = rawUrl => {
      try {
        const url = new URL(String(rawUrl || ''), location.href);
        if (!/(?:^|\.)(?:volcengine\.com|volces\.com|volcengineapi\.com)$/i.test(url.hostname)) return false;
        const target = `${url.pathname} ${url.search}`;
        return /(GetSeatUsageDetails|GetUsageDetails|GetSeatAFPUsage|ListSeatAFPUsage)/i.test(target)
          || /(?:agent[-_ ]?plan|seat).*(?:usage|token|detail|stat)/i.test(target)
          || /(?:usage|token|detail|stat).*(?:agent[-_ ]?plan|seat)/i.test(target);
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
      if (store.length > 80) store.splice(0, store.length - 80);
    };

    const originalFetch = window.fetch?.bind(window);
    if (originalFetch) {
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const rawUrl = response.url || args[0]?.url || args[0];
        if (relevant(rawUrl)) {
          response.clone().text().then(text => {
            if (!text || text.length > 12_000_000) return;
            try { remember(rawUrl, JSON.parse(text), 'fetch'); } catch { /* non-JSON response */ }
          }).catch(() => {});
        }
        return response;
      };
    }

    const proto = window.XMLHttpRequest?.prototype;
    if (proto && !proto.__tokenOnKindleVolcengineWrapped) {
      proto.__tokenOnKindleVolcengineWrapped = true;
      const originalOpen = proto.open;
      const originalSend = proto.send;
      proto.open = function(method, url, ...rest) {
        this.__tokenOnKindleVolcengineUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      proto.send = function(...args) {
        this.addEventListener('load', () => {
          const rawUrl = this.responseURL || this.__tokenOnKindleVolcengineUrl;
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

  installVolcengineNetworkCapture();

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


  function volcengineModelDetailRoot() {
    const title = exactVisibleElement('模型调用明细');
    if (!title) return null;
    let node = title;
    let best = title.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (!text.includes('模型调用明细') || text.length > 30_000) continue;
      best = node;
      if (node.querySelector('table, [role="row"], .aml-arco-table')) return node;
    }
    return best;
  }

  function volcengineModelsFromDom() {
    const root = volcengineModelDetailRoot();
    if (!root) return [];
    const rows = [...root.querySelectorAll('tbody tr, [role="row"], .aml-arco-table-tr')];
    const byModel = new Map();
    for (const row of rows) {
      const cells = [...row.querySelectorAll('th,td,[role="cell"],.aml-arco-table-td')]
        .map(cell => clean(cell.innerText || cell.textContent || ''))
        .filter(Boolean);
      if (cells.length < 2) continue;
      const rowText = cells.join(' | ');
      if (/(模型名称|总\s*Token|输入\s*Token|输出\s*Token|调用次数)/i.test(rowText) && !/[\d]/.test(rowText)) continue;
      const name = cells.find(text => /[A-Za-z\u4e00-\u9fff]/.test(text)
        && !/^(全部模型|套餐内用量|超额用量|模型|日期|Token|调用次数|AFP)$/i.test(text)
        && text.length <= 120);
      if (!name) continue;
      const keyed = (label) => {
        const match = rowText.match(new RegExp(`${label}[^\\d]{0,12}([\\d,.]+(?:\\.\\d+)?(?:万|亿)?)`, 'i'));
        return match ? scaledNumber(match[1]) : null;
      };
      const numbers = cells.map(scaledNumber).filter(value => value != null && value >= 0);
      const model = {
        id: name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, ''),
        name,
        totalTokens: keyed('(?:总\\s*)?Token') ?? (numbers.length ? Math.max(...numbers) : null),
        inputTokens: keyed('(?:输入|Prompt|Input)\\s*Token'),
        outputTokens: keyed('(?:输出|Completion|Output)\\s*Token'),
        cachedTokens: keyed('(?:缓存|Cache(?:d| Hit)?)\\s*Token'),
        requests: keyed('(?:调用|请求)(?:次数|数)?'),
        afp: keyed('AFP')
      };
      if (model.totalTokens == null && model.inputTokens == null && model.outputTokens == null) continue;
      byModel.set(name.toLowerCase(), model);
    }
    return [...byModel.values()].sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0));
  }

  function volcengineUsageReady() {
    const body = document.body?.innerText || '';
    return VOLCENGINE_WINDOWS.every(item => body.includes(item.label));
  }

  function collectVolcengine() {
    const windows = VOLCENGINE_WINDOWS.map(collectVolcengineWindow).filter(Boolean);
    const networkResponses = [...(window.__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__ || [])];
    const parsed = window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE__?.(networkResponses) || null;
    const domModels = parsed?.models?.length ? [] : volcengineModelsFromDom();
    const models = parsed?.models?.length ? parsed.models : domModels;
    const modelUsageSource = parsed?.models?.length ? 'http' : domModels.length ? 'dom' : 'none';
    return {
      source,
      capturedAt: new Date().toISOString(),
      plan: 'Agent Plan 企业版',
      unit: 'AFP',
      windows,
      models,
      modelUsage: {
        source: modelUsageSource,
        sourcePath: parsed?.sourcePath || null,
        capturedAt: parsed?.capturedAt || null
      },
      url: location.href,
      diagnostics: {
        primarySource: windows.length ? 'enterprise-usage-view' : 'waiting-for-enterprise-usage-view',
        instruction: windows.length ? null : '进入 Agent Plan 企业版的“用量统计”，看到三张 AFP 用量卡后点击“同步至 Kindle”',
        quotaCount: windows.length,
        usageViewReady: volcengineUsageReady(),
        modelUsageSource,
        modelCount: models.length,
        networkResponseCount: networkResponses.length,
        modelParser: parsed?.diagnostics || null
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
  async function collectAndSignal(options = {}) {
    if (collecting) return;
    applySyncOptions(options);
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
    hide.onclick = () => window.close();
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
      await originalCollectAndSignal(options);
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
    const marker = location.href;
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
