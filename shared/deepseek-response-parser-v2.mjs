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

export function parseDeepSeekResponses(responses, now = new Date()) {
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
