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

export function parseVolcengineEchartsOption(option = {}, suppliedLegendNames = [], metadata = {}) {
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
