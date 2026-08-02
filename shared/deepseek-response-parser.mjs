const DATE_RE = /20\d{2}[-/]\d{1,2}[-/]\d{1,2}/;
const MODEL_RE = /deepseek[-_ ]?v?4[-_ ]?(flash|pro)|(?:^|[-_ ])(flash|pro)(?:$|[-_ ])/i;

const cleanKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const cleanDate = value => {
  const match = String(value ?? '').match(DATE_RE);
  if (!match) return null;
  const [year, month, day] = match[0].replaceAll('/', '-').split('-');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};
const finite = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const compact = String(value).replaceAll(',', '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(compact)) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
};

function modelFrom(value) {
  const match = String(value ?? '').match(MODEL_RE);
  return (match?.[1] || match?.[2] || '').toLowerCase() || null;
}

function metricFromKey(key) {
  const compact = cleanKey(key);
  if (!compact) return null;
  if (/(cachehit|promptcachehit|hitcache)/.test(compact) && /(token|tokens|amount|count)/.test(compact)) return 'cacheHitTokens';
  if (/(cachemiss|promptcachemiss|misscache)/.test(compact) && /(token|tokens|amount|count)/.test(compact)) return 'cacheMissTokens';
  if (/(output|completion|response)/.test(compact) && /(token|tokens|amount|count)/.test(compact)) return 'outputTokens';
  if (/(input|prompt)/.test(compact) && /(token|tokens|amount|count)/.test(compact) && !/cache/.test(compact)) return 'inputTokens';
  if (/^(tokens?|totaltokens?|tokenamount|tokenusage|usedtokens?)$/.test(compact)) return 'tokens';
  if (/(cost|fee|charge|expense|consume|spend|amountcny|cnyamount|totalamount)/.test(compact) && !/(token|request)/.test(compact)) return 'cost';
  if (/(requests?|requestcount|apirequests?|calls?)/.test(compact)) return 'requests';
  return null;
}

function dateFromObject(object, inheritedDate = null) {
  for (const [key, value] of Object.entries(object || {})) {
    if (/(date|day|time|timestamp|statdate|createdat|starttime)/i.test(key)) {
      const date = cleanDate(value);
      if (date) return date;
    }
  }
  return inheritedDate;
}

function modelFromObject(object, inheritedModel = null) {
  for (const [key, value] of Object.entries(object || {})) {
    if (/(model|modelname|model_name|name|product|sku)/i.test(key)) {
      const model = modelFrom(value);
      if (model) return model;
    }
  }
  return inheritedModel;
}

function addRecord(records, record) {
  if (!record.model || !record.metric || record.value == null) return;
  records.push(record);
}

function walkRecords(value, records, context = {}, path = '$', depth = 0) {
  if (depth > 14 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkRecords(item, records, context, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;

  const date = dateFromObject(value, context.date);
  const model = modelFromObject(value, context.model) || modelFrom(path);
  const nextContext = { date, model };

  for (const [key, child] of Object.entries(value)) {
    const keyModel = modelFrom(key) || model;
    const metric = metricFromKey(key);
    const scalar = finite(child);
    if (metric && scalar != null && keyModel) {
      addRecord(records, {
        model: keyModel,
        metric,
        value: scalar,
        date,
        path: `${path}.${key}`,
        confidence: date ? 4 : 2
      });
    }

    if (child && typeof child === 'object') {
      walkRecords(child, records, { date, model: keyModel }, `${path}.${key}`, depth + 1);
    }
  }
}

function candidateDateAxis(object) {
  const arrays = [];
  for (const [key, value] of Object.entries(object || {})) {
    if (!Array.isArray(value) || !value.length) continue;
    const dates = value.map(cleanDate);
    if (dates.filter(Boolean).length >= Math.max(1, value.length * 0.6)) arrays.push({ key, dates });
  }
  return arrays[0] || null;
}

function seriesName(series, fallback = '') {
  return String(series?.name ?? series?.seriesName ?? series?.label ?? series?.model ?? fallback);
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
  const direct = metricFromKey(combined);
  if (direct) return direct;
  if (/cache\s*hit/i.test(combined)) return 'cacheHitTokens';
  if (/cache\s*miss/i.test(combined)) return 'cacheMissTokens';
  if (/(output|completion|response).*token/i.test(combined)) return 'outputTokens';
  if (/(token|tokens)/i.test(combined)) return 'tokens';
  if (/(cost|cny|fee|charge|expense|spend)/i.test(combined)) return 'cost';
  if (/(request|calls)/i.test(combined)) return 'requests';
  return null;
}

function walkSeries(value, records, path = '$', depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSeries(item, records, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;

  const axis = candidateDateAxis(value);
  const seriesCollections = [];
  for (const [key, child] of Object.entries(value)) {
    if (!Array.isArray(child) || !child.length || !child.every(item => item && typeof item === 'object')) continue;
    if (child.some(item => seriesValues(item))) seriesCollections.push({ key, items: child });
  }

  for (const collection of seriesCollections) {
    for (const series of collection.items) {
      const name = seriesName(series, collection.key);
      const model = modelFrom(name) || modelFrom(path);
      const metric = metricFromContext(`${path}.${collection.key}`, name);
      const values = seriesValues(series);
      if (!model || !metric || !values) continue;
      values.forEach((point, index) => {
        const parsed = pointValue(point);
        if (parsed == null) return;
        const date = cleanDate(point?.date || point?.name || point?.x) || axis?.dates?.[index] || null;
        addRecord(records, {
          model,
          metric,
          value: parsed,
          date,
          path: `${path}.${collection.key}[${index}]`,
          confidence: date ? 5 : 2
        });
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') walkSeries(child, records, `${path}.${key}`, depth + 1);
  }
}

function localDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function choose(records, model, metric, wantedDate) {
  const matches = records.filter(item => item.model === model && item.metric === metric && item.value >= 0);
  if (!matches.length) return null;
  const dated = matches.filter(item => item.date === wantedDate);
  const pool = dated.length ? dated : matches.filter(item => item.date).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const selectedPool = pool.length ? pool.filter(item => item.date === pool[0].date) : matches;
  return selectedPool.sort((a, b) => b.confidence - a.confidence)[0] || null;
}

export function parseDeepSeekResponses(responses, now = new Date()) {
  const records = [];
  const diagnostics = [];
  for (const response of responses || []) {
    if (!response?.body || typeof response.body !== 'object') continue;
    const before = records.length;
    walkRecords(response.body, records, {}, response.path || '$');
    walkSeries(response.body, records, response.path || '$');
    const discovered = records.length - before;
    if (discovered) diagnostics.push({ path: response.path || '/', records: discovered });
  }

  const date = localDate(now);
  const models = {};
  for (const model of ['flash', 'pro']) {
    const selected = {};
    for (const metric of ['tokens', 'inputTokens', 'cacheHitTokens', 'cacheMissTokens', 'outputTokens', 'cost', 'requests']) {
      selected[metric] = choose(records, model, metric, date);
    }

    const components = ['inputTokens', 'cacheHitTokens', 'cacheMissTokens', 'outputTokens']
      .map(metric => selected[metric]?.value)
      .filter(value => value != null);
    const tokens = selected.tokens?.value ?? (components.length ? components.reduce((sum, value) => sum + value, 0) : null);
    const hit = selected.cacheHitTokens?.value ?? null;
    const miss = selected.cacheMissTokens?.value ?? null;
    models[model] = {
      name: `deepseek-v4-${model}`,
      date: selected.tokens?.date || selected.cost?.date || selected.cacheHitTokens?.date || null,
      tokens,
      cost: selected.cost?.value ?? null,
      cacheHitTokens: hit,
      cacheMissTokens: miss,
      outputTokens: selected.outputTokens?.value ?? null,
      cacheRate: hit != null && miss != null && hit + miss > 0 ? hit / (hit + miss) * 100 : null,
      requests: selected.requests?.value ?? null,
      evidence: Object.fromEntries(Object.entries(selected).filter(([, item]) => item).map(([metric, item]) => [metric, { date: item.date, path: item.path }]))
    };
  }

  const list = Object.values(models);
  const todayTokens = list.every(model => model.tokens != null) ? list.reduce((sum, model) => sum + model.tokens, 0) : null;
  const todayCost = list.every(model => model.cost != null) ? list.reduce((sum, model) => sum + model.cost, 0) : null;
  const totalHit = list.reduce((sum, model) => sum + (model.cacheHitTokens || 0), 0);
  const totalMiss = list.reduce((sum, model) => sum + (model.cacheMissTokens || 0), 0);

  return {
    date,
    models,
    todayTokens,
    todayCost,
    cacheRate: totalHit + totalMiss > 0 ? totalHit / (totalHit + totalMiss) * 100 : null,
    diagnostics: {
      responseCount: (responses || []).length,
      recordCount: records.length,
      matchedResponses: diagnostics.slice(-12),
      responsePaths: [...new Set((responses || []).map(item => item.path).filter(Boolean))].slice(-20)
    }
  };
}
