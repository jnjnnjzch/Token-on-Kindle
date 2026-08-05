/* TOKEN-ON-KINDLE DIRECT READERS BUILD */
(() => {
  'use strict';
  const defined = object => Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== undefined));
  const compactDeepSeekModel = model => model ? defined({
    name: model.name,
    date: model.date,
    tokens: model.tokens,
    cost: model.cost,
    cacheHitTokens: model.cacheHitTokens,
    cacheMissTokens: model.cacheMissTokens,
    outputTokens: model.outputTokens,
    cacheRate: model.cacheRate,
    requests: model.requests
  }) : null;
  const compactVolcengineModel = model => model ? defined({
    id: model.id,
    name: model.name,
    totalTokens: model.totalTokens ?? model.tokens,
    latestTokens: model.latestTokens,
    peakTokens: model.peakTokens,
    pointCount: model.pointCount,
    inputTokens: model.inputTokens,
    outputTokens: model.outputTokens,
    cachedTokens: model.cachedTokens,
    requests: model.requests,
    afp: model.afp
  }) : null;

  window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__ = (source, payload = {}) => {
    const common = defined({
      source,
      capturedAt: payload.capturedAt,
      updateIntervalMinutes: payload.updateIntervalMinutes,
      syncRequestedAt: payload.syncRequestedAt
    });
    if (source === 'codex') {
      return defined({
        ...common,
        account: payload.account,
        quotas: Array.isArray(payload.quotas) ? payload.quotas : []
      });
    }
    if (source === 'deepseek') {
      return defined({
        ...common,
        balance: payload.balance,
        date: payload.date,
        todayCost: payload.todayCost,
        todayTokens: payload.todayTokens,
        todayRequests: payload.todayRequests,
        cacheRate: payload.cacheRate,
        models: {
          flash: compactDeepSeekModel(payload.models?.flash),
          pro: compactDeepSeekModel(payload.models?.pro)
        },
        account: payload.account,
        range: payload.range,
        diagnostics: defined({
          primarySource: payload.diagnostics?.primarySource,
          directError: payload.diagnostics?.directError
        })
      });
    }
    return defined({
      ...common,
      plan: payload.plan,
      unit: payload.unit,
      windows: Array.isArray(payload.windows) ? payload.windows : [],
      models: Array.isArray(payload.models) ? payload.models.map(compactVolcengineModel).filter(Boolean) : [],
      modelUsage: payload.modelUsage ? defined({
        source: payload.modelUsage.source,
        periodStart: payload.modelUsage.periodStart,
        periodEnd: payload.modelUsage.periodEnd,
        granularity: payload.modelUsage.granularity
      }) : undefined,
      diagnostics: defined({
        primarySource: payload.diagnostics?.primarySource,
        instruction: payload.diagnostics?.instruction,
        quotaCount: payload.diagnostics?.quotaCount,
        usageViewReady: payload.diagnostics?.usageViewReady,
        modelUsageSource: payload.diagnostics?.modelUsageSource,
        modelCount: payload.diagnostics?.modelCount
      })
    });
  };
})();
(() => {
  if (!location.hostname.endsWith('deepseek.com')) return;
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
  if (!location.hostname.endsWith('deepseek.com')) return;
const normalizeLine = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

const SUMMARY_LABEL = /^(cost|api requests|tokens|balance|费用|消耗|请求|余额)$/i;

function numeric(value) {
  const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function money(value) {
  const compact = String(value ?? '').replaceAll(',', '');
  const match = compact.match(/(?:¥|￥|CNY|RMB)\s*(-?\d+(?:\.\d+)?)/i)
    || compact.match(/(-?\d+(?:\.\d+)?)\s*(?:元|CNY|RMB)/i);
  return match ? Number(match[1]) : null;
}

function valueAfterExactLabel(lines, labels, parser) {
  const normalizedLabels = labels.map(label => label.toLowerCase());
  for (let index = 0; index < lines.length; index += 1) {
    if (!normalizedLabels.includes(lines[index].toLowerCase())) continue;
    for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate) continue;
      const parsed = parser(candidate);
      if (parsed != null) return { value: parsed, raw: candidate, label: lines[index], method: 'exact-label' };
      if (SUMMARY_LABEL.test(candidate)) break;
    }
  }
  return null;
}

function moneyAfterExactLabel(lines, labels) {
  const normalizedLabels = labels.map(label => label.toLowerCase());
  for (let index = 0; index < lines.length; index += 1) {
    if (!normalizedLabels.includes(lines[index].toLowerCase())) continue;

    const nearby = [];
    for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate) continue;
      if (SUMMARY_LABEL.test(candidate)) break;

      nearby.push(candidate);
      const combined = nearby.join(' ');
      const parsed = money(combined);
      if (parsed != null) {
        return {
          value: parsed,
          raw: combined,
          label: lines[index],
          method: nearby.length === 1 ? 'exact-label' : 'adjacent-lines'
        };
      }
    }
  }
  return null;
}

function inlineMoney(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const beforeAmount = new RegExp(`${escaped}[^¥￥\\d]{0,100}(?:¥|￥|CNY|RMB)\\s*([\\d,.]+)`, 'i');
    const afterAmount = new RegExp(`${escaped}[^\\d]{0,100}([\\d,.]+)\\s*(?:元|CNY|RMB)`, 'i');
    const match = String(text).match(beforeAmount) || String(text).match(afterAmount);
    if (match) return { value: Number(match[1].replaceAll(',', '')), raw: match[0], label, method: 'inline-label' };
  }
  return null;
}

function summaryMoneyMetric(text, lines, labels) {
  return moneyAfterExactLabel(lines, labels) || inlineMoney(text, labels) || null;
}

function parseDeepSeekSummaryText(text) {
  const rawText = String(text ?? '');
  const lines = rawText.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  return {
    balance: summaryMoneyMetric(rawText, lines, ['Balance', '账户余额', '可用余额', '充值余额', '余额']),
    cost: summaryMoneyMetric(rawText, lines, ['Cost', '费用', '消耗']),
    requests: valueAfterExactLabel(lines, ['API requests', 'API 请求', '请求'], numeric),
    tokens: valueAfterExactLabel(lines, ['Tokens', 'Token'], numeric),
    diagnostics: {
      lineCount: lines.length,
      matchedLabels: lines.filter(line => SUMMARY_LABEL.test(line)).slice(0, 12)
    }
  };
}

  window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__ = parseDeepSeekSummaryText;
})();
(() => {
  if (!location.hostname.endsWith('deepseek.com')) return;
const finite = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(number) ? number : null;
};

function unwrap(body, label) {
  if (!body || typeof body !== 'object') throw new Error(`${label}: missing response`);
  if (body.code != null && Number(body.code) !== 0) throw new Error(`${label}: code ${body.code}`);
  const data = body.data;
  if (!data || typeof data !== 'object') throw new Error(`${label}: missing data`);
  if (data.biz_code != null && Number(data.biz_code) !== 0) throw new Error(`${label}: biz_code ${data.biz_code}`);
  return data.biz_data;
}

function dateLocal(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateUtc(now) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function chooseDate(amountDays, costDays, now) {
  const dates = new Set([
    ...amountDays.map(day => String(day?.date || '')).filter(Boolean),
    ...costDays.map(day => String(day?.date || '')).filter(Boolean)
  ]);
  for (const candidate of [dateLocal(now), dateUtc(now)]) {
    if (dates.has(candidate)) return candidate;
  }
  return [...dates].sort().at(-1) || dateLocal(now);
}

function modelKey(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('v4-flash') || /(^|[-_])flash($|[-_])/.test(text)) return 'flash';
  if (text.includes('v4-pro') || /(^|[-_])pro($|[-_])/.test(text)) return 'pro';
  return null;
}

function usageMap(day) {
  const map = new Map();
  for (const model of day?.data || []) {
    const name = String(model?.model || '');
    if (!name) continue;
    map.set(name, Array.isArray(model.usage) ? model.usage : []);
  }
  return map;
}

function tokenBreakdown(items) {
  const result = {
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    outputTokens: 0,
    requests: 0,
    tokens: 0,
    hasTokenData: false,
    hasRequestData: false
  };
  for (const item of items || []) {
    const type = String(item?.type || '').toUpperCase();
    const amount = finite(item?.amount);
    if (amount == null || amount < 0) continue;
    if (type === 'REQUEST') {
      result.requests += amount;
      result.hasRequestData = true;
      continue;
    }
    if (type === 'PROMPT_CACHE_HIT_TOKEN') result.cacheHitTokens += amount;
    else if (type === 'PROMPT_CACHE_MISS_TOKEN') result.cacheMissTokens += amount;
    else if (type === 'RESPONSE_TOKEN') result.outputTokens += amount;
    else if (!type.includes('TOKEN')) continue;
    result.tokens += amount;
    result.hasTokenData = true;
  }
  return result;
}

function costBreakdown(items) {
  let cost = 0;
  let hasCostData = false;
  for (const item of items || []) {
    const type = String(item?.type || '').toUpperCase();
    const amount = finite(item?.amount);
    if (amount == null || amount < 0 || type === 'REQUEST') continue;
    cost += amount;
    hasCostData = true;
  }
  return { cost, hasCostData };
}

function aggregateTokenDays(days) {
  const result = {
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    outputTokens: 0,
    requests: 0,
    tokens: 0,
    hasTokenData: false,
    hasRequestData: false
  };
  for (const day of days || []) {
    for (const model of day?.data || []) {
      const current = tokenBreakdown(model?.usage);
      result.cacheHitTokens += current.cacheHitTokens;
      result.cacheMissTokens += current.cacheMissTokens;
      result.outputTokens += current.outputTokens;
      result.requests += current.requests;
      result.tokens += current.tokens;
      result.hasTokenData ||= current.hasTokenData;
      result.hasRequestData ||= current.hasRequestData;
    }
  }
  return result;
}

function aggregateCostDays(days) {
  let cost = 0;
  let hasCostData = false;
  for (const day of days || []) {
    for (const model of day?.data || []) {
      const current = costBreakdown(model?.usage);
      cost += current.cost;
      hasCostData ||= current.hasCostData;
    }
  }
  return { cost, hasCostData };
}

function parseBalance(summaryBody) {
  const summary = unwrap(summaryBody, 'summary');
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new Error('summary: malformed biz_data');
  const normal = Array.isArray(summary.normal_wallets) ? summary.normal_wallets : [];
  const bonus = Array.isArray(summary.bonus_wallets) ? summary.bonus_wallets : [];
  const currencies = new Set([...normal, ...bonus].map(wallet => wallet?.currency).filter(Boolean));
  const currency = currencies.has('CNY') ? 'CNY' : [...currencies][0] || 'CNY';
  const toppedUp = normal.filter(wallet => wallet?.currency === currency).reduce((sum, wallet) => sum + (finite(wallet.balance) || 0), 0);
  const granted = bonus.filter(wallet => wallet?.currency === currency).reduce((sum, wallet) => sum + (finite(wallet.balance) || 0), 0);
  return {
    value: toppedUp + granted,
    currency,
    toppedUp,
    granted,
    monthlyCost: finite(summary.monthly_costs?.[0]?.amount),
    cumulativeCost: finite(summary.total_costs?.[0]?.amount),
    monthlyTokens: finite(summary.monthly_token_usage),
    monthlyRequests: finite(summary.total_usage)
  };
}

function parseDeepSeekPlatformPayloads({ summaryBody, amountBody, costBody, now = new Date() }) {
  const amountBiz = unwrap(amountBody, 'amount');
  if (!amountBiz || typeof amountBiz !== 'object' || Array.isArray(amountBiz)) throw new Error('amount: malformed biz_data');
  const costBiz = unwrap(costBody, 'cost');
  if (!Array.isArray(costBiz)) throw new Error('cost: malformed biz_data');

  const amountDays = Array.isArray(amountBiz.days) ? amountBiz.days : [];
  const selectedCostBucket = costBiz.find(item => item?.currency === 'CNY') || costBiz[0] || {};
  const costDays = Array.isArray(selectedCostBucket.days) ? selectedCostBucket.days : [];
  const date = chooseDate(amountDays, costDays, now);
  const amountModels = usageMap(amountDays.find(day => day?.date === date));
  const costModels = usageMap(costDays.find(day => day?.date === date));
  const allModelNames = new Set([...amountModels.keys(), ...costModels.keys()]);

  const models = {
    flash: { name: 'deepseek-v4-flash', date, tokens: null, cost: null, cacheHitTokens: null, cacheMissTokens: null, outputTokens: null, cacheRate: null, requests: null },
    pro: { name: 'deepseek-v4-pro', date, tokens: null, cost: null, cacheHitTokens: null, cacheMissTokens: null, outputTokens: null, cacheRate: null, requests: null }
  };

  let todayTokens = 0;
  let todayCost = 0;
  let todayRequests = 0;
  let totalHit = 0;
  let totalMiss = 0;
  let hasTokens = false;
  let hasCost = false;
  let hasRequests = false;

  for (const name of allModelNames) {
    const token = tokenBreakdown(amountModels.get(name));
    const cost = costBreakdown(costModels.get(name));
    if (token.hasTokenData) { todayTokens += token.tokens; hasTokens = true; }
    if (token.hasRequestData) { todayRequests += token.requests; hasRequests = true; }
    if (cost.hasCostData) { todayCost += cost.cost; hasCost = true; }
    totalHit += token.cacheHitTokens;
    totalMiss += token.cacheMissTokens;

    const key = modelKey(name);
    if (!key) continue;
    models[key] = {
      name,
      date,
      tokens: token.hasTokenData ? token.tokens : null,
      cost: cost.hasCostData ? cost.cost : null,
      cacheHitTokens: token.hasTokenData ? token.cacheHitTokens : null,
      cacheMissTokens: token.hasTokenData ? token.cacheMissTokens : null,
      outputTokens: token.hasTokenData ? token.outputTokens : null,
      cacheRate: token.cacheHitTokens + token.cacheMissTokens > 0
        ? token.cacheHitTokens / (token.cacheHitTokens + token.cacheMissTokens) * 100
        : null,
      requests: token.hasRequestData ? token.requests : null
    };
  }

  const balance = parseBalance(summaryBody);
  const monthlyTokenTotals = aggregateTokenDays(amountDays);
  const monthlyCostTotals = aggregateCostDays(costDays);
  const monthlyCost = monthlyCostTotals.hasCostData ? monthlyCostTotals.cost : balance.monthlyCost;
  const monthlyTokens = monthlyTokenTotals.hasTokenData ? monthlyTokenTotals.tokens : balance.monthlyTokens;
  const monthlyRequests = monthlyTokenTotals.hasRequestData ? monthlyTokenTotals.requests : balance.monthlyRequests;

  return {
    date,
    balance: { value: balance.value, currency: balance.currency, toppedUp: balance.toppedUp, granted: balance.granted },
    todayTokens: hasTokens ? todayTokens : null,
    todayCost: hasCost ? todayCost : null,
    todayRequests: hasRequests ? todayRequests : null,
    cacheRate: totalHit + totalMiss > 0 ? totalHit / (totalHit + totalMiss) * 100 : null,
    models,
    account: {
      monthlyCost,
      cumulativeCost: balance.cumulativeCost,
      monthlyTokens,
      monthlyRequests
    },
    diagnostics: {
      source: 'platform-internal-api',
      selectedDate: date,
      amountDayCount: amountDays.length,
      costDayCount: costDays.length,
      modelNames: [...allModelNames],
      monthlyAggregation: {
        cost: monthlyCostTotals.hasCostData ? 'summed-days' : balance.monthlyCost != null ? 'summary' : 'missing',
        tokens: monthlyTokenTotals.hasTokenData ? 'summed-days' : balance.monthlyTokens != null ? 'summary' : 'missing',
        requests: monthlyTokenTotals.hasRequestData ? 'summed-days' : balance.monthlyRequests != null ? 'summary' : 'missing'
      }
    }
  };
}

  window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_PLATFORM__ = parseDeepSeekPlatformPayloads;
})();
(() => {
  if (!location.hostname.endsWith('volcengine.com')) return;
const DATE_RE = /20\d{2}[-/]\d{1,2}[-/]\d{1,2}/;
const GENERIC_SERIES = /^(tokens?|total|value|series\s*\d+|全部模型|模型|model)$/i;

const finite = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const parsed = finite(value[index]);
      if (parsed != null) return parsed;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['value', 'y', 'amount', 'count', 'tokens', 'tokenCount']) {
      const parsed = finite(value[key]);
      if (parsed != null) return parsed;
    }
    return null;
  }
  const text = String(value).replaceAll(',', '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanName = value => String(value ?? '').trim();
const modelId = name => cleanName(name).toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
  .replace(/^-|-$/g, '');

const dateText = value => cleanName(value).match(DATE_RE)?.[0]?.replaceAll('/', '-') || null;

function flattenLegendData(option = {}) {
  const entries = Array.isArray(option.legend) ? option.legend : option.legend ? [option.legend] : [];
  return entries.flatMap(legend => Array.isArray(legend?.data) ? legend.data : [])
    .map(item => cleanName(typeof item === 'object' ? item.name : item))
    .filter(Boolean);
}

function normalizeLegendNames(option, supplied = []) {
  const names = [...supplied, ...flattenLegendData(option)].map(cleanName).filter(Boolean);
  return [...new Map(names.map(name => [name.toLowerCase(), name])).values()];
}

function xAxisValues(option = {}) {
  const axes = Array.isArray(option.xAxis) ? option.xAxis : option.xAxis ? [option.xAxis] : [];
  for (const axis of axes) {
    if (Array.isArray(axis?.data) && axis.data.length) return axis.data.map(item => cleanName(typeof item === 'object' ? item.value : item));
  }
  return [];
}

function pointValues(data = []) {
  return data.map(finite).filter(value => value != null && value >= 0);
}

function modelNameForSeries(series, index, legendNames) {
  const explicit = cleanName(series?.name);
  if (explicit && !GENERIC_SERIES.test(explicit)) return explicit;
  return legendNames[index] || explicit || null;
}

function seriesModels(option, legendNames) {
  const series = Array.isArray(option?.series) ? option.series : [];
  const models = [];
  const legendSet = new Set(legendNames.map(name => name.toLowerCase()));
  series.forEach((entry, index) => {
    const name = modelNameForSeries(entry, index, legendNames);
    if (!name) return;
    if (legendSet.size && !legendSet.has(name.toLowerCase())) return;
    const values = pointValues(Array.isArray(entry?.data) ? entry.data : []);
    if (!values.length && !legendNames.some(item => item.toLowerCase() === name.toLowerCase())) return;
    models.push({
      id: modelId(name),
      name,
      totalTokens: values.reduce((sum, value) => sum + value, 0),
      latestTokens: values.length ? values.at(-1) : 0,
      peakTokens: values.length ? Math.max(...values) : 0,
      pointCount: values.length
    });
  });
  return models;
}

function datasetSources(option = {}) {
  const datasets = Array.isArray(option.dataset) ? option.dataset : option.dataset ? [option.dataset] : [];
  return datasets.map(dataset => dataset?.source).filter(Array.isArray);
}

function modelsFromArrayRows(source, legendNames) {
  if (!Array.isArray(source) || !Array.isArray(source[0])) return [];
  const header = source[0].map(cleanName);
  const rows = source.slice(1);
  const names = legendNames.length ? legendNames : header.slice(1).filter(name => name && !/date|time|day|日期|时间/i.test(name));
  return names.map(name => {
    const column = header.findIndex(item => item.toLowerCase() === name.toLowerCase());
    if (column < 0) return null;
    const values = rows.map(row => finite(row?.[column])).filter(value => value != null && value >= 0);
    return {
      id: modelId(name),
      name,
      totalTokens: values.reduce((sum, value) => sum + value, 0),
      latestTokens: values.length ? values.at(-1) : 0,
      peakTokens: values.length ? Math.max(...values) : 0,
      pointCount: values.length
    };
  }).filter(Boolean);
}

function modelsFromObjectRows(source, legendNames) {
  if (!Array.isArray(source) || !source.length || !source.every(row => row && typeof row === 'object' && !Array.isArray(row))) return [];
  const keys = [...new Set(source.flatMap(row => Object.keys(row)))];
  const names = legendNames.length ? legendNames : keys.filter(key => !/date|time|day|日期|时间/i.test(key));
  return names.map(name => {
    const key = keys.find(item => item.toLowerCase() === name.toLowerCase());
    if (!key) return null;
    const values = source.map(row => finite(row[key])).filter(value => value != null && value >= 0);
    return {
      id: modelId(name),
      name,
      totalTokens: values.reduce((sum, value) => sum + value, 0),
      latestTokens: values.length ? values.at(-1) : 0,
      peakTokens: values.length ? Math.max(...values) : 0,
      pointCount: values.length
    };
  }).filter(Boolean);
}

function datasetModels(option, legendNames) {
  for (const source of datasetSources(option)) {
    const models = modelsFromArrayRows(source, legendNames);
    if (models.length) return models;
    const objectModels = modelsFromObjectRows(source, legendNames);
    if (objectModels.length) return objectModels;
  }
  return [];
}

function mergeModels(models, legendNames) {
  const byName = new Map();
  for (const model of models) {
    const key = model.name.toLowerCase();
    const current = byName.get(key);
    if (!current || model.pointCount > current.pointCount) byName.set(key, model);
  }
  for (const name of legendNames) {
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { id: modelId(name), name, totalTokens: 0, latestTokens: 0, peakTokens: 0, pointCount: 0 });
  }
  return [...byName.values()].sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0) || a.name.localeCompare(b.name));
}

function parseVolcengineEchartsOption(option = {}, suppliedLegendNames = [], metadata = {}) {
  const legendNames = normalizeLegendNames(option, suppliedLegendNames);
  const direct = seriesModels(option, legendNames);
  const directHasPoints = direct.some(model => model.pointCount > 0);
  const fromDataset = directHasPoints ? [] : datasetModels(option, legendNames);
  const models = mergeModels(directHasPoints ? direct : fromDataset, legendNames);
  const axis = xAxisValues(option);
  const dates = axis.map(dateText).filter(Boolean);
  const periodStart = metadata.periodStart || dates[0] || null;
  const periodEnd = metadata.periodEnd || dates.at(-1) || null;
  return {
    models,
    periodStart,
    periodEnd,
    granularity: metadata.granularity || null,
    diagnostics: {
      seriesCount: Array.isArray(option?.series) ? option.series.length : 0,
      datasetCount: datasetSources(option).length,
      legendNames,
      xAxisCount: axis.length,
      pointCount: models.reduce((sum, model) => sum + model.pointCount, 0),
      extractionMode: directHasPoints ? 'series' : fromDataset.length ? 'dataset' : legendNames.length ? 'legend-only' : 'none'
    }
  };
}

  window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__ = parseVolcengineEchartsOption;
const hasChartData = option => Boolean(option && (Array.isArray(option.series) || option.dataset));

function inspectReactEchartsFiber(rootFiber) {
  const seen = new Set();
  for (let fiber = rootFiber, depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
    for (const candidate of [fiber, fiber.alternate]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      const stateNode = candidate.stateNode;
      try {
        if (stateNode && typeof stateNode.getEchartsInstance === 'function') {
          const instance = stateNode.getEchartsInstance();
          const option = instance?.getOption?.();
          if (hasChartData(option)) return { option, method: 'react-component' };
        }
        if (stateNode?.echarts && typeof stateNode.echarts.getOption === 'function') {
          const option = stateNode.echarts.getOption();
          if (hasChartData(option)) return { option, method: 'react-state-node' };
        }
      } catch {
        // The chart class can exist before its ECharts instance finishes mounting.
      }
      for (const props of [candidate.memoizedProps, candidate.pendingProps, stateNode?.props]) {
        const option = props?.option;
        if (hasChartData(option)) return { option, method: 'react-props' };
      }
    }
  }
  return null;
}

function readEchartsOptionFromElement(chart, echartsGlobal = null) {
  if (!chart) return null;
  try {
    const instance = echartsGlobal?.getInstanceByDom?.(chart);
    const option = instance?.getOption?.();
    if (hasChartData(option)) return { option, method: 'echarts-global' };
  } catch {
    // Ark bundles ECharts as a module, so a window-level instance is optional.
  }

  for (let node = chart, depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    for (const key of Object.getOwnPropertyNames(node)) {
      if (!/^__react(?:Fiber|InternalInstance|Container)\$.+/.test(key)) continue;
      const found = inspectReactEchartsFiber(node[key]);
      if (found) return found;
    }
  }
  return null;
}

  window.__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__ = readEchartsOptionFromElement;
})();
/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR START */
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

  function signal(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__?.(source, { ...payload, updateIntervalMinutes: syncState.refreshMinutes, syncRequestedAt: syncState.syncRequestedAt }) || payload));
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
    const models = volcengineModelsFromDom();
    const modelUsageSource = models.length ? 'dom' : 'none';
    return {
      source,
      capturedAt: new Date().toISOString(),
      plan: 'Agent Plan 企业版',
      unit: 'AFP',
      windows,
      models,
      modelUsage: {
        source: modelUsageSource,
        sourcePath: null,
        capturedAt: null
      },
      url: location.href,
      diagnostics: {
        primarySource: windows.length ? 'enterprise-usage-view' : 'waiting-for-enterprise-usage-view',
        instruction: windows.length ? null : '进入 Agent Plan 企业版的“用量统计”，看到三张 AFP 用量卡后点击“同步至 Kindle”',
        quotaCount: windows.length,
        usageViewReady: volcengineUsageReady(),
        modelUsageSource,
        modelCount: models.length
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
      await originalCollectAndSignal(options);
      if (source === 'volcengine' && !volcengineUsageReady()) return;
      sessionStorage.setItem('__token_on_kindle_synced_view', location.href);
      setToolbarStatus(options.manual ? '已发送至主程序，主界面收到后会更新' : '后台数据已发送', 'success');
    } catch (error) {
      setToolbarStatus('同步失败：' + String(error?.message || error).slice(0, 80), 'error');
      console.error('[Token on Kindle] collection failed', error);
    }
  };
  window.__TOKEN_ON_KINDLE_SYNC__ = collectAndSignal;

  function start() {
    toolbar();
    if (source === 'codex') {
      setTimeout(() => collectAndSignal({ automatic: true }), 2500);
      setTimeout(() => collectAndSignal({ automatic: true }), 7000);
    } else if (source === 'deepseek') {
      setToolbarStatus('等待 DeepSeek Platform 直读器同步余额与模型明细');
    } else {
      setToolbarStatus('等待企业版用量页面；轻量图表读取器将在页面就绪后同步');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR END */
(() => {
  'use strict';
  if (!location.hostname.endsWith('deepseek.com') || window.__TOKEN_ON_KINDLE_DEEPSEEK_DIRECT_READER__) return;
  window.__TOKEN_ON_KINDLE_DEEPSEEK_DIRECT_READER__ = true;

  const legacySync = window.__TOKEN_ON_KINDLE_SYNC__;
  const finite = value => {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const parsed = Number(String(value).replaceAll(',', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const state = { collecting: false, lastSummary: {}, lastPayload: null, retryTimer: null };

  function applySyncOptions(options = {}) {
    const refreshMinutes = finite(options.refreshMinutes ?? options.refresh_minutes);
    if (refreshMinutes != null) sessionStorage.setItem('__token_on_kindle_refresh_minutes', String(refreshMinutes));
    if (options.syncRequestedAt) sessionStorage.setItem('__token_on_kindle_sync_requested_at', String(options.syncRequestedAt));
  }

  function encodeSignal(payload) {
    const refreshMinutes = finite(sessionStorage.getItem('__token_on_kindle_refresh_minutes'));
    const syncRequestedAt = sessionStorage.getItem('__token_on_kindle_sync_requested_at') || null;
    const bytes = new TextEncoder().encode(JSON.stringify(window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__?.('deepseek', { ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt }) || payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  function signal(payload) {
    const title = document.title;
    const encoded = encodeSignal(payload);
    document.title = `__TOKEN_ON_KINDLE__:deepseek:${encoded}`;
    setTimeout(() => { document.title = title || 'DeepSeek Platform'; }, 250);
  }

  function status(message, stateName = '') {
    const note = document.querySelector('#__token_on_kindle_status');
    if (!note) return;
    note.textContent = message;
    note.dataset.state = stateName;
  }

  function platformToken() {
    const raw = localStorage.getItem('userToken');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : parsed?.value || parsed?.token || null;
    } catch {
      return raw;
    }
  }

  async function platformJson(path, token) {
    const response = await fetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      credentials: 'include'
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  async function visibleSummary(attempts = 3) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const parsed = window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__?.(document.body?.innerText || '') || {};
      if (parsed.balance || parsed.cost || parsed.tokens || parsed.requests) {
        state.lastSummary = { ...state.lastSummary, ...parsed };
        return state.lastSummary;
      }
      if (attempt + 1 < attempts) await sleep(250);
    }
    return state.lastSummary;
  }

  async function fetchPlatformUsage() {
    const token = platformToken();
    if (!token) throw new Error('DeepSeek Platform 登录令牌不存在');
    const now = new Date();
    const periods = [
      { month: now.getMonth() + 1, year: now.getFullYear() },
      { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() }
    ].filter((item, index, all) => all.findIndex(other => other.month === item.month && other.year === item.year) === index);
    const summaryBody = await platformJson('/api/v0/users/get_user_summary', token);
    const attempts = [];
    for (const period of periods) {
      try {
        const query = `month=${period.month}&year=${period.year}`;
        const [amountBody, costBody] = await Promise.all([
          platformJson(`/api/v0/usage/amount?${query}`, token),
          platformJson(`/api/v0/usage/cost?${query}`, token)
        ]);
        attempts.push(window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_PLATFORM__({ summaryBody, amountBody, costBody, now }));
      } catch (error) {
        attempts.push({ error: String(error?.message || error), date: null });
      }
    }
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const utcDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const parsed = attempts.find(item => item?.date === localDate)
      || attempts.find(item => item?.date === utcDate)
      || attempts.filter(item => !item?.error).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!parsed) throw new Error(attempts.map(item => item.error).filter(Boolean).join(' | ') || 'DeepSeek 用量响应为空');
    parsed.diagnostics = {
      ...parsed.diagnostics,
      attempts: attempts.map(item => item?.error ? { error: item.error } : { date: item?.date || null })
    };
    return parsed;
  }

  function payloadFrom(parsed, summary) {
    const balance = parsed.balance || (summary.balance ? { value: summary.balance.value, currency: 'CNY' } : null);
    return {
      source: 'deepseek',
      capturedAt: new Date().toISOString(),
      url: location.href,
      balance,
      date: parsed.date || null,
      todayCost: parsed.todayCost == null ? null : { value: parsed.todayCost, currency: balance?.currency || 'CNY' },
      todayTokens: parsed.todayTokens == null ? null : { value: parsed.todayTokens },
      todayRequests: parsed.todayRequests == null ? null : { value: parsed.todayRequests },
      cacheRate: parsed.cacheRate == null ? null : { value: parsed.cacheRate },
      models: parsed.models || { flash: null, pro: null },
      account: parsed.account || null,
      range: {
        cost: summary.cost?.value ?? null,
        tokens: summary.tokens?.value ?? null,
        requests: summary.requests?.value ?? null
      },
      diagnostics: {
        primarySource: 'platform-internal-api',
        parser: parsed.diagnostics || null,
        visibleSummary: summary.diagnostics || null
      }
    };
  }

  async function directSync(options = {}) {
    if (state.collecting) return state.lastPayload;
    state.collecting = true;
    applySyncOptions(options);
    status('正在读取 DeepSeek Platform…');
    try {
      const [summary, parsed] = await Promise.all([visibleSummary(options.manual ? 4 : 2), fetchPlatformUsage()]);
      const payload = payloadFrom(parsed, summary);
      state.lastPayload = payload;
      signal(payload);
      status('已发送余额、Flash/Pro Token 与缓存明细', 'success');
      return payload;
    } catch (error) {
      const message = String(error?.message || error);
      status(`直读失败，使用页面回退：${message.slice(0, 54)}`, 'warning');
      if (typeof legacySync === 'function') {
        await legacySync(options);
        return state.lastPayload;
      }
      throw error;
    } finally {
      state.collecting = false;
    }
  }

  function installOverride() {
    window.__TOKEN_ON_KINDLE_SYNC__ = directSync;
    const button = [...document.querySelectorAll('#__token_on_kindle_toolbar button')]
      .find(element => String(element.textContent || '').trim() === '同步至 Kindle');
    if (button && button.dataset.deepseekDirect !== 'true') {
      button.dataset.deepseekDirect = 'true';
      button.onclick = () => directSync({ manual: true });
    }
  }

  function schedule(options, delay) {
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      installOverride();
      directSync(options).catch(() => {});
    }, delay);
  }

  function start() {
    installOverride();
    setTimeout(() => { installOverride(); directSync({ automatic: true, startup: true }).catch(() => {}); }, 1800);
    setTimeout(() => { installOverride(); if (!state.lastPayload) directSync({ automatic: true, startup: true }).catch(() => {}); }, 5200);
  }

  window.addEventListener('pageshow', () => schedule({ automatic: true, pageshow: true }, 500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule({ automatic: true, visible: true }, 500);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

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
    const bytes = new TextEncoder().encode(JSON.stringify(window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__?.('volcengine', { ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt }) || payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  function signal(payload) {
    const title = document.title;
    const encoded = encodeSignal(payload);
    document.title = `__TOKEN_ON_KINDLE__:volcengine:${encoded}`;
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
        chart.models.length ? `已发送 AFP 与 ${chart.models.length} 个模型` : '已发送 AFP；模型图表尚未就绪',
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

