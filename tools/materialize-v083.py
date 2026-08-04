import os
import re
import subprocess
from pathlib import Path

BRANCH = 'agent/volcengine-model-token-v083'
ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing {label}')
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f'missing start for {label}: {start}')
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f'missing end for {label}: {end}')
    return text[:start_index] + replacement + text[end_index:]


if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_HEAD_REF') == BRANCH:
    subprocess.run(['git', 'fetch', 'origin', BRANCH], check=True)
    subprocess.run(['git', 'checkout', '-B', BRANCH, f'origin/{BRANCH}'], check=True)

parser_path = Path('shared/volcengine-response-parser.mjs')
parser_path.write_text(r'''const cleanKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');

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
''', encoding='utf-8')

extractor_path = Path('web/extractor-base.js')
extractor = extractor_path.read_text(encoding='utf-8')

network_capture = r'''
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
'''
extractor = replace_once(
    extractor,
    '  installDeepSeekNetworkCapture();\n',
    '  installDeepSeekNetworkCapture();\n' + network_capture,
    'Volcengine network capture anchor'
)

dom_helpers = r'''
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

'''
extractor = replace_once(
    extractor,
    '  function volcengineUsageReady() {\n',
    dom_helpers + '  function volcengineUsageReady() {\n',
    'Volcengine DOM parser anchor'
)

collect_function = r'''  function collectVolcengine() {
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

'''
extractor = replace_between(
    extractor,
    '  function collectVolcengine() {',
    '  async function collectDeepSeek() {',
    collect_function,
    'collectVolcengine'
)
extractor_path.write_text(extractor, encoding='utf-8')

# Bundle both pure response parsers before the actual external-page collector.
def browser_bundle(module_path: str, export_name: str, global_name: str) -> str:
    source = Path(module_path).read_text(encoding='utf-8')
    source = source.replace(f'export function {export_name}', f'function {export_name}')
    if f'export function {export_name}' in source or re.search(r'^export\s', source, re.M):
        raise SystemExit(f'unhandled export in {module_path}')
    return f"(() => {{\n{source}\nwindow.{global_name} = {export_name};\n}})();\n"

compiled = (
    browser_bundle('shared/deepseek-response-parser-v2.mjs', 'parseDeepSeekResponses', '__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__')
    + browser_bundle('shared/volcengine-response-parser.mjs', 'parseVolcengineModelUsageResponses', '__TOKEN_ON_KINDLE_PARSE_VOLCENGINE__')
    + extractor
)
Path('web/extractor.js').write_text(compiled, encoding='utf-8')

renderer_path = Path('web/kindle-renderer.js')
renderer = renderer_path.read_text(encoding='utf-8')
renderer = replace_once(
    renderer,
    "  return sources.map(source => ({ codex: 132, deepseek: 294, volcengine: 138 })[source]);",
    "  return sources.map(source => ({ codex: 122, deepseek: 272, volcengine: 170 })[source]);",
    'three-source preferred heights'
)

volc_renderer = r'''function normalizeVolcengineWindows(volcengine = {}) {
  const windows = Array.isArray(volcengine.windows) ? volcengine.windows.filter(Boolean) : [];
  const find = ids => windows.find(item => ids.includes(String(item?.id || '').toLowerCase())) || null;
  return [
    find(['5h', 'five-hour', 'near-5h']) || windows.find(item => /5\s*小时/.test(item?.label || '')),
    find(['weekly', 'week']) || windows.find(item => /一周|周/.test(item?.label || '')),
    find(['monthly', 'month']) || windows.find(item => /一月|月/.test(item?.label || ''))
  ];
}

export function normalizeVolcengineModels(volcengine = {}) {
  const models = Array.isArray(volcengine.models) ? volcengine.models.filter(Boolean) : [];
  return models.map((model, index) => {
    const inputTokens = numericValue(model.inputTokens);
    const outputTokens = numericValue(model.outputTokens);
    const totalTokens = numericValue(model.totalTokens ?? model.tokens)
      ?? (inputTokens != null || outputTokens != null ? (inputTokens || 0) + (outputTokens || 0) : null);
    return {
      id: String(model.id || model.modelId || index),
      name: String(model.name || model.modelName || model.id || `模型 ${index + 1}`),
      totalTokens,
      inputTokens,
      outputTokens,
      cachedTokens: numericValue(model.cachedTokens),
      requests: numericValue(model.requests),
      afp: numericValue(model.afp)
    };
  }).sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0) || a.name.localeCompare(b.name));
}

export function volcengineModelLayoutPlan(boxHeight, modelCount) {
  const count = Math.max(0, Number(modelCount) || 0);
  if (!count) return { hasModels: false, quotaHeight: Math.max(0, boxHeight - 45), columns: 0, rows: 0, capacity: 0, visibleCount: 0, overflowCount: 0 };
  const compact = boxHeight < 210;
  const medium = boxHeight < 340;
  const quotaHeight = compact ? 46 : medium ? 62 : 96;
  const sectionGap = compact ? 4 : medium ? 6 : 9;
  const modelHeaderHeight = compact ? 12 : 16;
  const modelAreaHeight = Math.max(24, boxHeight - 39 - quotaHeight - sectionGap - 8);
  const columns = count === 1 ? 1 : count <= 4 ? 2 : (boxHeight >= 240 ? 3 : 2);
  const minimumCellHeight = compact ? 24 : medium ? 36 : 50;
  const rows = Math.max(1, Math.floor((modelAreaHeight - modelHeaderHeight) / minimumCellHeight));
  const capacity = Math.max(1, rows * columns);
  const visibleCount = count <= capacity ? count : Math.max(0, capacity - 1);
  return {
    hasModels: true,
    compact,
    medium,
    quotaHeight,
    sectionGap,
    modelHeaderHeight,
    modelAreaHeight,
    columns,
    rows,
    capacity,
    visibleCount,
    overflowCount: Math.max(0, count - visibleCount)
  };
}

function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {
  const labels = ['5 小时', '一周', '一月'];
  const cellWidth = (box.width - 24) / 3;
  windows.forEach((entry, index) => {
    const left = box.x + 12 + index * cellWidth;
    const center = left + cellWidth / 2;
    if (index > 0) drawLine(ctx, left, y + 3, left, y + height - 3, 1, PALETTE.dark);
    const usedPercent = numericValue(entry?.usedPercent)
      ?? (numericValue(entry?.used) != null && numericValue(entry?.total) ? numericValue(entry.used) / numericValue(entry.total) * 100 : null);
    const compact = height < 56;
    drawText(ctx, entry?.label ? shorten(entry.label.replace('近', ''), 9) : labels[index], center, y + 2, compact ? 8.5 : 10, 750, 'center', PALETTE.dark);
    drawText(ctx, `${formatNumber(entry?.used)} / ${formatNumber(entry?.total)}`, center, y + (compact ? 14 : 18), compact ? 9.5 : 12, 820, 'center');
    const barY = y + (compact ? 29 : 37);
    drawBar(ctx, left + 7, barY, cellWidth - 14, compact ? 5 : 7, usedPercent == null ? 0 : usedPercent / 100);
    if (!compact) drawText(ctx, formatPercent(usedPercent), center, barY + 10, 8.5, 650, 'center', PALETTE.dark);
  });
}

function drawVolcengineModelCell(ctx, model, x, y, width, height, compact) {
  drawBox(ctx, x, y, width, height, PALETTE.paper, PALETTE.dark, 1);
  const nameSize = compact ? 8 : height < 46 ? 8.5 : 10;
  const totalSize = compact ? 10.5 : height < 46 ? 12 : 16;
  drawText(ctx, shorten(model.name, width > 170 ? 24 : 16), x + 7, y + (compact ? 4 : 5), nameSize, 750, 'left', PALETTE.dark);
  drawText(ctx, formatTokens(model.totalTokens), x + width - 7, y + (compact ? 3 : 4), totalSize, 850, 'right');
  if (height >= 42) {
    const detailY = y + (height >= 58 ? 27 : 23);
    drawText(ctx, `入 ${formatTokens(model.inputTokens)}`, x + 7, detailY, 8, 650, 'left', PALETTE.dark);
    drawText(ctx, `出 ${formatTokens(model.outputTokens)}`, x + width - 7, detailY, 8, 650, 'right', PALETTE.dark);
  }
  if (height >= 65) {
    const bottom = y + height - 14;
    drawText(ctx, `缓存 ${formatTokens(model.cachedTokens)}`, x + 7, bottom, 8, 600, 'left', PALETTE.mid);
    const right = model.requests != null ? `${formatNumber(model.requests)} 次` : model.afp != null ? `${formatNumber(model.afp)} AFP` : '';
    if (right) drawText(ctx, right, x + width - 7, bottom, 8, 600, 'right', PALETTE.mid);
  }
}

function drawVolcengineModels(ctx, models, box, y, height, plan) {
  drawText(ctx, '模型 TOKEN', box.x + 12, y, plan.compact ? 9 : 10.5, 800, 'left', PALETTE.dark);
  drawText(ctx, `${models.length} 个模型`, box.x + box.width - 12, y, plan.compact ? 8.5 : 9.5, 650, 'right', PALETTE.dark);
  const gridY = y + plan.modelHeaderHeight;
  const gap = plan.compact ? 3 : 5;
  const gridWidth = box.width - 24;
  const cellWidth = (gridWidth - gap * (plan.columns - 1)) / plan.columns;
  const rowCount = Math.max(1, Math.ceil(Math.min(plan.capacity, plan.visibleCount + (plan.overflowCount ? 1 : 0)) / plan.columns));
  const cellHeight = Math.max(20, (height - plan.modelHeaderHeight - gap * (rowCount - 1)) / rowCount);
  const entries = models.slice(0, plan.visibleCount).map(model => ({ type: 'model', model }));
  if (plan.overflowCount) entries.push({ type: 'overflow', count: plan.overflowCount });
  entries.forEach((entry, index) => {
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    const x = box.x + 12 + column * (cellWidth + gap);
    const cellY = gridY + row * (cellHeight + gap);
    if (entry.type === 'model') {
      drawVolcengineModelCell(ctx, entry.model, x, cellY, cellWidth, cellHeight, plan.compact || cellHeight < 34);
    } else {
      drawBox(ctx, x, cellY, cellWidth, cellHeight, PALETTE.white, PALETTE.dark, 1);
      drawText(ctx, `其余 ${entry.count} 个模型`, x + cellWidth / 2, cellY + Math.max(4, (cellHeight - 11) / 2), plan.compact ? 8.5 : 10, 750, 'center', PALETTE.dark);
    }
  });
}

function drawVolcengine(ctx, volcengine = {}, box) {
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, PALETTE.ink, 2);
  const models = normalizeVolcengineModels(volcengine);
  drawCardTitle(ctx, '火山方舟 AFP', box, models.length ? `Agent Plan · ${models.length} 模型` : 'Agent Plan 企业版');
  const windows = normalizeVolcengineWindows(volcengine);
  if (!windows.some(Boolean)) {
    drawText(ctx, '尚未同步', box.x + 18, box.y + 55, box.height > 240 ? 30 : 22, 850);
    drawText(ctx, '进入企业版用量统计，看到 AFP 卡片后点击同步', box.x + 18, box.y + 94, box.height > 240 ? 14 : 10, 600, 'left', PALETTE.dark);
    return;
  }
  const plan = volcengineModelLayoutPlan(box.height, models.length);
  if (models.length) {
    const quotaY = box.y + 39;
    drawVolcengineQuotaStrip(ctx, windows, box, quotaY, plan.quotaHeight);
    const modelY = quotaY + plan.quotaHeight + plan.sectionGap;
    drawVolcengineModels(ctx, models, box, modelY, plan.modelAreaHeight, plan);
    return;
  }
  const bodyY = box.y + 39;
  const rowHeight = (box.height - 45) / 3;
  const labels = ['近 5 小时', '近一周', '近一月'];
  windows.forEach((entry, index) => {
    const y = bodyY + index * rowHeight;
    if (index > 0) drawLine(ctx, box.x + 12, y, box.x + box.width - 12, y, 1, PALETTE.dark);
    const usedPercent = numericValue(entry?.usedPercent) ?? (numericValue(entry?.used) != null && numericValue(entry?.total) ? numericValue(entry.used) / numericValue(entry.total) * 100 : null);
    drawText(ctx, entry?.label || labels[index], box.x + 14, y + 5, rowHeight < 48 ? 9.5 : 12, 750, 'left', PALETTE.dark);
    drawText(ctx, `${formatNumber(entry?.used)} / ${formatNumber(entry?.total)} AFP`, box.x + box.width - 14, y + 4, rowHeight < 48 ? 10.5 : 14, 800, 'right');
    const barY = y + (rowHeight < 48 ? 23 : 31);
    drawBar(ctx, box.x + 14, barY, box.width - 28, rowHeight < 48 ? 6 : 9, usedPercent == null ? 0 : usedPercent / 100);
    if (rowHeight >= 52) {
      drawText(ctx, `已用 ${formatPercent(usedPercent)}`, box.x + 14, barY + 12, 9, 650, 'left', PALETTE.dark);
      drawText(ctx, entry?.resetText ? shorten(entry.resetText, 28) : '重置时间未知', box.x + box.width - 14, barY + 12, 9, 600, 'right', PALETTE.dark);
    }
  });
}

'''
renderer = replace_between(
    renderer,
    'function normalizeVolcengineWindows(',
    'function drawHeader(',
    volc_renderer,
    'Volcengine renderer'
)
renderer_path.write_text(renderer, encoding='utf-8')

Path('tests/volcengine-model-usage-v083.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseVolcengineModelUsageResponses } from '../shared/volcengine-response-parser.mjs';
import { normalizeVolcengineModels, sourceLayoutBoxes, volcengineModelLayoutPlan } from '../web/kindle-renderer.js';

const base = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const compiled = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

const response = (order, body, path = '/api?Action=GetSeatUsageDetails') => ({ order, body, path, capturedAt: `2026-08-04T0${order}:00:00Z` });

test('Volcengine HTTP parser accepts enterprise seat model detail aliases', () => {
  const parsed = parseVolcengineModelUsageResponses([
    response(1, {
      Result: {
        UsageDetails: [
          { ModelName: 'doubao-seed-1-6', TotalTokens: 1200, InputTokens: 800, OutputTokens: 400, RequestCount: 3 },
          { model_name: 'deepseek-v3.2', prompt_tokens: 2000, completion_tokens: 600, cache_hit_tokens: 500, calls: 7 },
          { FoundationModelName: 'kimi-k2', TokenCount: '3,200', AFPUsage: 12.5 }
        ]
      }
    })
  ]);
  assert.equal(parsed.models.length, 3);
  assert.deepEqual(parsed.models.map(model => model.name), ['kimi-k2', 'deepseek-v3.2', 'doubao-seed-1-6']);
  const deepseek = parsed.models.find(model => model.name === 'deepseek-v3.2');
  assert.equal(deepseek.totalTokens, 2600);
  assert.equal(deepseek.cachedTokens, 500);
  assert.equal(deepseek.requests, 7);
});

test('newest matching response wins instead of summing repeated refresh payloads', () => {
  const parsed = parseVolcengineModelUsageResponses([
    response(1, { rows: [{ modelName: 'doubao-seed', totalTokens: 100 }] }),
    response(2, { rows: [{ modelName: 'doubao-seed', totalTokens: 135 }] })
  ]);
  assert.equal(parsed.models.length, 1);
  assert.equal(parsed.models[0].totalTokens, 135);
  assert.equal(parsed.diagnostics.selectedOrder, 2);
});

test('model layout changes columns and capacity with count and card height', () => {
  const single = volcengineModelLayoutPlan(584, 1);
  const compact = volcengineModelLayoutPlan(170, 8);
  const medium = volcengineModelLayoutPlan(226, 4);
  const tall = volcengineModelLayoutPlan(584, 8);
  assert.equal(single.columns, 1);
  assert.equal(compact.columns, 2);
  assert.ok(compact.overflowCount > 0);
  assert.equal(medium.columns, 2);
  assert.equal(tall.columns, 3);
  assert.equal(tall.overflowCount, 0);
  for (const plan of [compact, medium, tall]) {
    assert.ok(plan.quotaHeight + plan.modelAreaHeight + plan.sectionGap + 47 <= (plan === compact ? 170 : plan === medium ? 226 : 584) + 2);
  }
});

test('three-source layout gives Volcengine room for quota strip and model grid', () => {
  const boxes = sourceLayoutBoxes({ codex: true, deepseek: true, volcengine: true });
  assert.deepEqual(boxes.map(box => box.height), [122, 272, 170]);
  assert.equal(boxes.at(-1).y + boxes.at(-1).height, 666);
});

test('renderer normalizes and sorts arbitrary Volcengine model counts', () => {
  const models = normalizeVolcengineModels({ models: [
    { name: 'B', inputTokens: 10, outputTokens: 15 },
    { name: 'A', totalTokens: 100 },
    { name: 'C', totalTokens: 50 }
  ] });
  assert.deepEqual(models.map(model => model.name), ['A', 'C', 'B']);
  assert.equal(models[2].totalTokens, 25);
});

test('real packaged extractor contains Volcengine HTTP capture and both parsers', () => {
  for (const marker of ['GetSeatUsageDetails', 'GetSeatAFPUsage', '__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__', '__TOKEN_ON_KINDLE_PARSE_VOLCENGINE__']) {
    assert.match(base, new RegExp(marker));
    assert.match(compiled, new RegExp(marker));
  }
  assert.match(compiled, /source = host === 'chatgpt\.com'.*volcengine/s);
  assert.doesNotMatch(compiled, /setInterval\(\(\) => location\.reload\(\), UPDATE_MS\)/);
});
''', encoding='utf-8')

Path('docs/v0.8.3.md').write_text('''# v0.8.3\n\n- Capture the authenticated Volcengine console model-usage JSON responses used by Agent Plan Enterprise.\n- Parse model names, total/input/output/cached tokens, requests, and AFP across common API field aliases.\n- Fall back to the visible model-detail table when the console response shape is unavailable.\n- Render AFP quotas as a compact three-cell strip when model data exists.\n- Adapt the model Token grid to one, two, or three columns and reserve the final slot for an overflow summary when the model count exceeds the Kindle card capacity.\n- Rebuild `web/extractor.js` from the current response parsers and collector so the source tested in the repository is the source embedded in the native executable.\n''', encoding='utf-8')

subprocess.run(['node', 'tools/sync-version.mjs', '0.8.3'], check=True)

# Remove this one-time script before validating and committing the real source tree.
Path('tools/materialize-v083.py').unlink(missing_ok=True)
subprocess.run(['npm', 'test'], check=True)

if os.environ.get('GITHUB_ACTIONS') == 'true':
    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
    subprocess.run(['git', 'add', '-A'], check=True)
    result = subprocess.run(['git', 'diff', '--cached', '--quiet'])
    if result.returncode != 0:
        subprocess.run(['git', 'commit', '-m', 'v0.8.3: capture and adapt Volcengine model tokens'], check=True)
        subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'], check=True)
