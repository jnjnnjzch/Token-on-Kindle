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

export function parseVolcengineModelUsageResponses(responses = []) {
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
