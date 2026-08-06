const SECRET_KEY = /(authorization|cookie|secret|password|passwd|credential|session|signature|security|access.?key|secret.?key|csrf|bearer|access.?token|refresh.?token|id.?token|user.?token|session.?token|security.?token)/i;
const SECRET_QUERY_KEY = /^(authorization|cookie|token|access_token|refresh_token|id_token|secret|signature|session|csrf)$/i;
const INTERESTING_KEY = /(action|afp|quota|used|usage|reset|token|input|output|cache|request|model|seat|plan|limit|remain|consume|amount|stat|detail)/i;
const AFP_KEY = /(afp|five.?hour|weekly|monthly|quota|reset.?time|remaining|used)/i;
const MODEL_KEY = /(model|token|input|output|cache|request|series|dataset|prompt|completion)/i;
const QUERY_HINT = /(get|list|query|describe|search|usage|stat|detail|quota|afp|billing|consume|amount)/i;
const MUTATION_HINT = /(create|update|delete|remove|bind|unbind|purchase|subscribe|cancel|reset|modify|set|grant|revoke|invite|pay|order|enable|disable)/i;

const cleanText = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function primitiveType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function sanitizeVolcengineUrl(rawUrl, baseUrl = 'https://console.volcengine.com/') {
  try {
    const url = new URL(String(rawUrl || ''), baseUrl);
    const kept = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (SECRET_QUERY_KEY.test(key) || SECRET_KEY.test(key)) continue;
      if (/(action|version|model|date|day|start|end|from|to|granularity|interval|page|size|limit|region)/i.test(key)) {
        kept.set(key, cleanText(value).slice(0, 120));
      }
    }
    const query = kept.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return cleanText(rawUrl).replace(/([?&](?:token|secret|signature|authorization|session|csrf)=[^&]*)/ig, '').slice(0, 260);
  }
}

function sanitizeScalar(key, value) {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  const text = cleanText(value);
  if (!text) return '';
  if (text.length > 160) return `${text.slice(0, 157)}...`;
  return text;
}

export function summarizeVolcengineRequestBody(rawBody) {
  if (rawBody == null || rawBody === '') return null;
  let parsed = rawBody;
  let format = typeof rawBody;
  if (typeof rawBody === 'string') {
    const text = rawBody.trim();
    if (!text) return null;
    try {
      parsed = JSON.parse(text);
      format = 'json';
    } catch {
      try {
        const params = new URLSearchParams(text);
        const object = {};
        for (const [key, value] of params) object[key] = value;
        parsed = object;
        format = 'form';
      } catch {
        return { format: 'text', length: text.length, preview: text.slice(0, 120) };
      }
    }
  }

  const keys = [];
  const hints = {};
  const visit = (value, path = '', depth = 0) => {
    if (depth > 4 || keys.length >= 120 || value == null) return;
    if (Array.isArray(value)) {
      keys.push(`${path || '$'}[]`);
      for (let index = 0; index < Math.min(value.length, 3); index += 1) visit(value[index], `${path}[${index}]`, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      keys.push(next);
      if (INTERESTING_KEY.test(key) && !SECRET_KEY.test(key) && primitiveType(child) !== 'object' && primitiveType(child) !== 'array') {
        hints[next] = sanitizeScalar(key, child);
      }
      visit(child, next, depth + 1);
      if (keys.length >= 120) break;
    }
  };
  visit(parsed);
  return { format, keys: [...new Set(keys)].slice(0, 120), hints };
}

export function collectVolcengineJsonPaths(payload, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 7;
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 360;
  const paths = [];
  const relevantValues = {};
  const visit = (value, path = '$', depth = 0) => {
    if (paths.length >= maxEntries || depth > maxDepth) return;
    if (Array.isArray(value)) {
      paths.push(`${path}[]`);
      for (let index = 0; index < Math.min(value.length, 4); index += 1) visit(value[index], `${path}[${index}]`, depth + 1);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (paths.length >= maxEntries) break;
      const next = `${path}.${key}`;
      paths.push(next);
      const type = primitiveType(child);
      if (INTERESTING_KEY.test(key) && !SECRET_KEY.test(key) && type !== 'object' && type !== 'array') {
        relevantValues[next] = sanitizeScalar(key, child);
      }
      visit(child, next, depth + 1);
    }
  };
  visit(payload);
  return { paths: [...new Set(paths)], relevantValues };
}

function scorePaths(paths, matcher, weights) {
  let score = 0;
  const matches = [];
  for (const path of paths) {
    if (!matcher.test(path)) continue;
    matches.push(path);
    const lower = path.toLowerCase();
    let weight = 1;
    for (const [pattern, points] of weights) {
      if (pattern.test(lower)) weight = Math.max(weight, points);
    }
    score += weight;
  }
  return { score, matches: matches.slice(0, 80) };
}

export function classifyVolcengineDebugPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { relevant: false, score: 0, kinds: [], topLevelKeys: [], matchedPaths: [], relevantValues: {} };
  }
  const { paths, relevantValues } = collectVolcengineJsonPaths(payload);
  const afp = scorePaths(paths, AFP_KEY, [
    [/afpfivehour|five.?hour/, 5],
    [/afpweekly|weekly/, 4],
    [/afpmonthly|monthly/, 4],
    [/quota/, 3],
    [/reset.?time/, 3],
    [/\.used$|remaining/, 2]
  ]);
  const models = scorePaths(paths, MODEL_KEY, [
    [/model/, 3],
    [/total.?tokens?|token.?count/, 4],
    [/input.?tokens?|prompt.?tokens?/, 4],
    [/output.?tokens?|completion.?tokens?/, 4],
    [/cache/, 3],
    [/requests?/, 2],
    [/series|dataset/, 2]
  ]);
  const seatBonus = paths.some(path => /seat.?id|plan.?type/i.test(path)) ? 4 : 0;
  const score = afp.score + models.score + seatBonus;
  const kinds = [];
  if (afp.score >= 6) kinds.push('afp');
  if (models.score >= 6) kinds.push('models');
  if (seatBonus) kinds.push('seat');
  return {
    relevant: score >= 8 || kinds.length >= 2,
    score,
    kinds,
    topLevelKeys: Object.keys(payload).filter(key => !SECRET_KEY.test(key)).slice(0, 80),
    matchedPaths: [...new Set([...afp.matches, ...models.matches])].slice(0, 120),
    relevantValues,
    pathCount: paths.length
  };
}

export function isSafeVolcengineReplayCandidate(candidate = {}) {
  const method = String(candidate.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return true;
  if (method !== 'POST') return false;
  const url = cleanText(candidate.url || '');
  const body = candidate.bodySummary || summarizeVolcengineRequestBody(candidate.body);
  const searchable = `${url} ${body?.keys?.join(' ') || ''} ${Object.values(body?.hints || {}).join(' ')}`;
  if (MUTATION_HINT.test(searchable)) return false;
  return QUERY_HINT.test(searchable);
}

export function compareVolcengineDebugResults(input = {}) {
  const methods = {};
  for (const [name, value] of Object.entries(input)) {
    const present = Boolean(value && (Array.isArray(value) ? value.length : Object.keys(value).length));
    methods[name] = { present };
    if (value?.windows) methods[name].windowCount = value.windows.length;
    if (value?.models) methods[name].modelCount = value.models.length;
    if (value?.relevantCount != null) methods[name].relevantCount = value.relevantCount;
  }
  const successful = Object.entries(methods).filter(([, value]) => value.present).map(([name]) => name);
  return { successful, methodCount: successful.length, methods };
}
