const finiteNumber = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
const MODEL_KEYS = new Set([
  'respmodelid', 'objectname', 'modelname', 'modelid', 'foundationmodelname',
  'foundationmodelid', 'endpointmodel', 'sku', 'displayname'
]);
const GENERIC_NAMES = /^(name|data|value|total|count|usage|detail|unknown|null|undefined|-|--)$/i;

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function valueByKey(object, candidates) {
  if (!safeObject(object)) return undefined;
  const wanted = new Set(candidates.map(cleanKey));
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(cleanKey(key))) return value;
  }
  return undefined;
}

function looksLikeModel(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 160 || GENERIC_NAMES.test(text)) return false;
  if (/^[\d.,:%/\s-]+$/.test(text)) return false;
  return /[A-Za-z\u4e00-\u9fff]/.test(text);
}

function modelFromObject(object) {
  if (!safeObject(object)) return null;
  for (const [key, value] of Object.entries(object)) {
    if (!MODEL_KEYS.has(cleanKey(key))) continue;
    if ((typeof value === 'string' || typeof value === 'number') && looksLikeModel(value)) {
      return String(value).trim();
    }
  }
  return null;
}

function canonicalMetric(value) {
  const key = cleanKey(value);
  if (!key) return null;
  if (/(cachehit|cached|cachetoken|hitcache)/.test(key) && /(token|amount|count|usage|value|^cached$)/.test(key)) {
    return 'cachedTokens';
  }
  if (/(cachemiss|uncached|noncache)/.test(key) && /(token|amount|count|usage|value)/.test(key)) {
    return 'inputTokens';
  }
  if (/(input|prompt|requestinput)/.test(key) && /(token|amount|count|usage|value|^input$)/.test(key) && !/cachehit|cached/.test(key)) {
    return 'inputTokens';
  }
  if (/(output|completion|response)/.test(key) && /(token|amount|count|usage|value|^output$)/.test(key)) {
    return 'outputTokens';
  }
  if (/^(totaltokens?|tokenstotal|tokens?|tokencount|tokenusage|total_token|total)$/.test(key)) {
    return 'totalTokens';
  }
  if (/(request|call)/.test(key) && /(count|total|times|number|num|usage|value|^requests?$|^calls?$)/.test(key)) {
    return 'requests';
  }
  if (/(afp|fuel)/.test(key) && /(usage|amount|count|used|consume|total|value|^afp$)/.test(key)) {
    return 'afp';
  }
  return null;
}

function timestampValue(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function pointFromObject(object) {
  if (!safeObject(object)) return null;
  const value = finiteNumber(valueByKey(object, ['Value', 'Count', 'Amount', 'Usage', 'TokenCount', 'Total']));
  if (value == null) return null;
  const timestamp = timestampValue(valueByKey(object, ['Timestamp', 'Time', 'Date', 'Day', 'BucketTime', 'StartTime']));
  return { timestamp, value };
}

function extractPoints(value, depth = 0) {
  if (depth > 8 || value == null) return [];
  const scalar = finiteNumber(value);
  if (scalar != null && (typeof value === 'number' || typeof value === 'string')) {
    return [{ timestamp: null, value: scalar }];
  }
  if (Array.isArray(value)) {
    const direct = value.map(pointFromObject).filter(Boolean);
    if (direct.length) return direct;
    const numeric = value.map(finiteNumber).filter(item => item != null);
    if (numeric.length === value.length && numeric.length) {
      return numeric.map(item => ({ timestamp: null, value: item }));
    }
    return value.flatMap(item => extractPoints(item, depth + 1));
  }
  if (!safeObject(value)) return [];
  const direct = pointFromObject(value);
  if (direct) return [direct];
  for (const key of ['Values', 'Points', 'MetricValues', 'DataPoints', 'Data', 'Items']) {
    const child = valueByKey(value, [key]);
    if (child != null) {
      const points = extractPoints(child, depth + 1);
      if (points.length) return points;
    }
  }
  return Object.values(value).flatMap(child => {
    if (!child || typeof child !== 'object') return [];
    return extractPoints(child, depth + 1);
  });
}

function containsMetricData(value, depth = 0) {
  if (depth > 5 || value == null) return false;
  if (Array.isArray(value)) return value.some(item => containsMetricData(item, depth + 1));
  if (!safeObject(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (canonicalMetric(key) && extractPoints(child).length) return true;
    if (['name', 'metricname', 'metrictype', 'usagetype'].includes(cleanKey(key))
        && canonicalMetric(child) && extractPoints(value).length) return true;
  }
  return Object.values(value).some(child => child && typeof child === 'object' && containsMetricData(child, depth + 1));
}

function collectModelNames(body) {
  const names = [];
  const seen = new Set();
  const add = value => {
    if (!looksLikeModel(value)) return;
    const text = String(value).trim();
    const key = text.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(text);
    }
  };
  const walk = (value, depth = 0) => {
    if (value == null || depth > 14) return;
    if (Array.isArray(value)) {
      value.forEach(item => walk(item, depth + 1));
      return;
    }
    if (!safeObject(value)) return;
    const model = modelFromObject(value);
    if (model) add(model);
    for (const [key, child] of Object.entries(value)) {
      const normalized = cleanKey(key);
      if (MODEL_KEYS.has(normalized) && (typeof child === 'string' || typeof child === 'number')) add(child);
      if (child && typeof child === 'object') walk(child, depth + 1);
    }
  };
  walk(body);
  return names;
}

function collectUsageSeries(body, modelNames) {
  const series = [];
  const walk = (value, context = {}, path = '$', depth = 0) => {
    if (value == null || depth > 18) return;
    if (Array.isArray(value)) {
      const positional = modelNames.length === value.length
        && value.length > 0
        && value.every(item => containsMetricData(item));
      value.forEach((item, index) => {
        const model = positional ? (modelFromObject(item) || modelNames[index]) : context.model;
        walk(item, { ...context, model }, `${path}[${index}]`, depth + 1);
      });
      return;
    }
    if (!safeObject(value)) return;

    const localModel = modelFromObject(value) || context.model || null;
    const namedMetric = canonicalMetric(valueByKey(value, ['MetricName', 'MetricType', 'UsageType', 'Name', 'Type']));
    if (namedMetric) {
      const points = extractPoints(value);
      if (points.length) series.push({ model: localModel, metric: namedMetric, points, path });
    }

    for (const [key, child] of Object.entries(value)) {
      const metric = canonicalMetric(key);
      if (metric) {
        const points = extractPoints(child);
        if (points.length) series.push({ model: localModel, metric, points, path: `${path}.${key}` });
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (!child || typeof child !== 'object') continue;
      if (Array.isArray(child)
          && modelNames.length === child.length
          && child.length > 0
          && child.every(item => containsMetricData(item))) {
        child.forEach((item, index) => {
          walk(item, { model: modelFromObject(item) || modelNames[index] }, `${path}.${key}[${index}]`, depth + 1);
        });
      } else {
        walk(child, { model: localModel }, `${path}.${key}`, depth + 1);
      }
    }
  };
  walk(body);
  return series;
}

function dedupeSeries(series) {
  const seen = new Set();
  return series.filter(item => {
    const signature = `${item.model || ''}|${item.metric}|${item.path}|${item.points.map(point => `${point.timestamp ?? ''}:${point.value}`).join(',')}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function aggregateModels(modelNames, rawSeries) {
  const series = dedupeSeries(rawSeries);
  const anonymous = series.filter(item => !item.model);
  if (anonymous.length && modelNames.length === 1) {
    anonymous.forEach(item => { item.model = modelNames[0]; });
  }

  const map = new Map();
  const ensure = name => {
    const key = name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        id: key.replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, ''),
        name,
        metrics: new Map(),
        evidencePaths: []
      });
    }
    return map.get(key);
  };
  modelNames.forEach(ensure);

  for (const item of series) {
    if (!item.model || !looksLikeModel(item.model)) continue;
    const model = ensure(String(item.model).trim());
    const bucket = model.metrics.get(item.metric) || [];
    bucket.push(...item.points);
    model.metrics.set(item.metric, bucket);
    model.evidencePaths.push(item.path);
  }

  const mergeByTimestamp = points => {
    const timestamped = new Map();
    const untimed = [];
    for (const point of points || []) {
      if (point.timestamp == null) untimed.push(point.value);
      else timestamped.set(point.timestamp, (timestamped.get(point.timestamp) || 0) + point.value);
    }
    if (timestamped.size) return [...timestamped.entries()].sort((a, b) => a[0] - b[0]).map(([timestamp, value]) => ({ timestamp, value }));
    return untimed.map(value => ({ timestamp: null, value }));
  };

  return [...map.values()].map(model => {
    const metricPoints = {};
    for (const metric of ['totalTokens', 'inputTokens', 'cachedTokens', 'outputTokens', 'requests', 'afp']) {
      metricPoints[metric] = mergeByTimestamp(model.metrics.get(metric) || []);
    }

    let tokenPoints = metricPoints.totalTokens;
    if (!tokenPoints.length) {
      const timestamps = new Set();
      for (const metric of ['inputTokens', 'cachedTokens', 'outputTokens']) {
        metricPoints[metric].forEach(point => {
          if (point.timestamp != null) timestamps.add(point.timestamp);
        });
      }
      if (timestamps.size) {
        tokenPoints = [...timestamps].sort((a, b) => a - b).map(timestamp => ({
          timestamp,
          value: ['inputTokens', 'cachedTokens', 'outputTokens'].reduce((sum, metric) => {
            return sum + (metricPoints[metric].find(point => point.timestamp === timestamp)?.value || 0);
          }, 0)
        }));
      } else {
        const values = ['inputTokens', 'cachedTokens', 'outputTokens'].flatMap(metric => metricPoints[metric].map(point => point.value));
        if (values.length) tokenPoints = [{ timestamp: null, value: values.reduce((sum, value) => sum + value, 0) }];
      }
    }

    const sum = metric => metricPoints[metric].reduce((total, point) => total + point.value, 0);
    const totalTokens = tokenPoints.reduce((total, point) => total + point.value, 0);
    const latestTokens = tokenPoints.length ? tokenPoints[tokenPoints.length - 1].value : 0;
    const peakTokens = tokenPoints.length ? Math.max(...tokenPoints.map(point => point.value)) : 0;
    return {
      id: model.id,
      name: model.name,
      totalTokens,
      latestTokens,
      peakTokens,
      pointCount: tokenPoints.length,
      inputTokens: sum('inputTokens'),
      cachedTokens: sum('cachedTokens'),
      outputTokens: sum('outputTokens'),
      requests: sum('requests'),
      afp: sum('afp'),
      evidencePaths: [...new Set(model.evidencePaths)].slice(0, 8)
    };
  }).sort((a, b) => b.latestTokens - a.latestTokens || b.totalTokens - a.totalTokens || a.name.localeCompare(b.name));
}

function parseWindow(id, label, value) {
  if (!safeObject(value)) return null;
  const total = finiteNumber(valueByKey(value, ['Quota', 'Total', 'Limit']));
  const used = finiteNumber(valueByKey(value, ['Used', 'Usage', 'Consumed']));
  const resetTime = finiteNumber(valueByKey(value, ['ResetTime', 'ResetAt']));
  const subscribeTime = finiteNumber(valueByKey(value, ['SubscribeTime', 'StartTime']));
  const usedPercent = total && used != null ? used / total * 100 : null;
  return {
    id,
    label,
    used,
    total,
    usedPercent,
    remainingPercent: usedPercent == null ? null : Math.max(0, 100 - usedPercent),
    resetTime,
    subscribeTime
  };
}

function parseAfp(body) {
  const result = body?.Result || body?.result || body;
  const seat = result?.SeatAFPUsages?.[0] || result?.Items?.[0] || result;
  const definitions = [
    ['5h', '近5小时用量', 'AFPFiveHour'],
    ['weekly', '近一周用量', 'AFPWeekly'],
    ['monthly', '近一月用量', 'AFPMonthly']
  ];
  return {
    planType: valueByKey(seat, ['PlanType']) || null,
    windows: definitions.map(([id, label, key]) => parseWindow(id, label, valueByKey(seat, [key]))).filter(Boolean)
  };
}

function findRange(value, depth = 0) {
  if (value == null || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRange(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!safeObject(value)) return null;
  const start = valueByKey(value, ['StartTime']);
  const end = valueByKey(value, ['EndTime']);
  if (start != null || end != null) {
    return { periodStart: start ?? null, periodEnd: end ?? null };
  }
  for (const child of Object.values(value)) {
    if (!child || typeof child !== 'object') continue;
    const found = findRange(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseVolcengineInternalApiPayloads({
  afpBody,
  modelListBody,
  usageBody,
  usageRequestBody,
  capturedAt = new Date().toISOString()
} = {}) {
  const afp = parseAfp(afpBody || {});
  const modelNames = collectModelNames(modelListBody || {});
  const usageSeries = collectUsageSeries(usageBody || {}, modelNames);
  const models = aggregateModels(modelNames, usageSeries);
  const range = findRange(usageRequestBody) || {};
  return {
    source: 'volcengine',
    capturedAt,
    plan: afp.planType ? `Agent Plan 企业版 · ${afp.planType}` : 'Agent Plan 企业版',
    unit: 'AFP',
    windows: afp.windows,
    models,
    modelUsage: {
      source: 'console-internal-api',
      periodStart: range.periodStart ?? null,
      periodEnd: range.periodEnd ?? null,
      granularity: valueByKey(usageRequestBody, ['QueryInterval']) || null
    },
    diagnostics: {
      primarySource: 'console-internal-api',
      quotaCount: afp.windows.length,
      modelCount: models.length,
      modelListCount: modelNames.length,
      usageSeriesCount: usageSeries.length
    }
  };
}

export const __volcengineInternalApiTest = {
  canonicalMetric,
  collectModelNames,
  collectUsageSeries,
  parseAfp,
  findRange
};
