(() => {
  'use strict';
  if (window.__TOKEN_ON_KINDLE_INSTALLED__) return;
  window.__TOKEN_ON_KINDLE_INSTALLED__ = true;

  const host = location.hostname;
  const source = host === 'chatgpt.com' ? 'codex' : host.endsWith('deepseek.com') ? 'deepseek' : null;
  if (!source) return;

  const NETWORK_KEY = '__TOKEN_ON_KINDLE_NETWORK__';
  const MAX_NETWORK_PAYLOADS = 24;
  window[NETWORK_KEY] ||= [];

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const num = value => {
    const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const scaled = value => {
    const match = String(value ?? '').replaceAll(',', '').match(/(-?\d+(?:\.\d+)?)\s*([KMB万亿]?)/i);
    if (!match) return null;
    const scale = { K: 1e3, M: 1e6, B: 1e9, '万': 1e4, '亿': 1e8 }[match[2].toUpperCase()] ?? 1;
    return Number(match[1]) * scale;
  };
  const money = text => {
    const value = String(text ?? '').replaceAll(',', '');
    const match = value.match(/(?:¥|￥|\$|CNY|RMB|USD)\s*(-?\d+(?:\.\d+)?)/i)
      || value.match(/(-?\d+(?:\.\d+)?)\s*(?:元|美元)/i);
    return match ? Number(match[1]) : null;
  };
  const pageLines = () => clean(document.body?.innerText || '')
    .split(/\n+/)
    .map(clean)
    .filter(Boolean);

  function isRelevantNetworkUrl(url) {
    return /(usage|billing|balance|stat|consume|cost|token|invoice|account)/i.test(String(url || ''));
  }

  function rememberNetworkPayload(url, payload) {
    if (!payload || typeof payload !== 'object') return;
    const preview = JSON.stringify(payload).slice(0, 3000);
    if (!isRelevantNetworkUrl(url) && !/(token|cost|amount|balance|cache|model|usage)/i.test(preview)) return;
    const list = window[NETWORK_KEY];
    list.push({ url: String(url || ''), payload, capturedAt: Date.now() });
    if (list.length > MAX_NETWORK_PAYLOADS) list.splice(0, list.length - MAX_NETWORK_PAYLOADS);
  }

  if (source === 'deepseek') {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || response.url;
        if (isRelevantNetworkUrl(url)) {
          response.clone().json().then(payload => rememberNetworkPayload(url, payload)).catch(() => {});
        }
      } catch (_) {}
      return response;
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__tokenOnKindleUrl = url;
      return nativeOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener('load', () => {
        try {
          if (!isRelevantNetworkUrl(this.__tokenOnKindleUrl)) return;
          const contentType = this.getResponseHeader('content-type') || '';
          if (!/json/i.test(contentType) && typeof this.responseText !== 'string') return;
          rememberNetworkPayload(this.__tokenOnKindleUrl, JSON.parse(this.responseText));
        } catch (_) {}
      }, { once: true });
      return nativeSend.apply(this, args);
    };
  }

  const reset = text => {
    const match = text.match(/(?:reset(?:s| at)?|next reset|renew(?:s|al)?|重置|恢复|下次重置)[：:\s]*([^\n|]{1,80})/i);
    return match ? clean(match[1]) : null;
  };
  const kind = text => {
    if (/(weekly|per week|week limit|7[- ]?day|本周|每周|周额度)/i.test(text)) return 'weekly';
    const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|小时)/i);
    if (hours) return `${hours[1]}h`;
    if (/(daily|day limit|today|今日|每天|日额度)/i.test(text)) return 'daily';
    if (/(monthly|month limit|本月|每月|月额度)/i.test(text)) return 'monthly';
    return 'unknown';
  };

  function quotaFrom(value, context) {
    if (value == null || value < 0 || value > 100) return null;
    if (!/(limit|quota|reset|remaining|used|week|hour|额度|限制|重置|剩余|已用|周|小时)/i.test(context)) return null;
    let remaining = null;
    let used = null;
    if (/(remaining|left|available|剩余|可用)/i.test(context)) {
      remaining = value;
      used = 100 - value;
    } else if (/(used|usage|consumed|已用|已使用|消耗)/i.test(context)) {
      used = value;
      remaining = 100 - value;
    }
    return {
      id: kind(context),
      displayedPercent: value,
      remainingPercent: remaining,
      usedPercent: used,
      resetText: reset(context)
    };
  }

  function codex() {
    const found = [];
    document.querySelectorAll('[role="progressbar"], [aria-valuenow], [aria-valuetext]').forEach(element => {
      const own = clean(element.getAttribute('aria-valuetext') || element.getAttribute('aria-valuenow') || element.textContent || '');
      const value = num(own);
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
    return { source, capturedAt: new Date().toISOString(), quotas, url: location.href };
  }

  function findMetric(lines, labels, parser, lookAhead = 4) {
    for (let i = 0; i < lines.length; i += 1) {
      if (!labels.some(label => lines[i].toLowerCase().includes(label.toLowerCase()))) continue;
      const context = lines.slice(i, Math.min(lines.length, i + lookAhead)).join(' ');
      const value = parser(context);
      if (value != null) return { value };
    }
    return null;
  }

  function primitiveObjectEntries(object) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return [];
    return Object.entries(object).filter(([, value]) => value == null || ['string', 'number', 'boolean'].includes(typeof value));
  }

  function walkObjects(value, out = [], depth = 0) {
    if (!value || typeof value !== 'object' || depth > 9 || out.length > 4000) return out;
    if (!Array.isArray(value)) out.push(value);
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') walkObjects(child, out, depth + 1);
    }
    return out;
  }

  function numericByKey(object, patterns, exclusions = []) {
    for (const [key, raw] of primitiveObjectEntries(object)) {
      const lower = key.toLowerCase();
      if (!patterns.some(pattern => pattern.test(lower))) continue;
      if (exclusions.some(pattern => pattern.test(lower))) continue;
      const value = typeof raw === 'number' ? raw : num(raw);
      if (value != null && Number.isFinite(value)) return value;
    }
    return null;
  }

  function stringByKey(object, patterns) {
    for (const [key, raw] of primitiveObjectEntries(object)) {
      if (!patterns.some(pattern => pattern.test(key.toLowerCase()))) continue;
      if (raw != null) return String(raw);
    }
    return '';
  }

  function modelKind(object) {
    const direct = stringByKey(object, [/model/, /sku/, /product/, /series/, /engine/]);
    const haystack = direct || JSON.stringify(object).slice(0, 800);
    if (/(v4[-_ ]?flash|deepseek[-_ ]?flash|\bflash\b)/i.test(haystack)) return 'flash';
    if (/(v4[-_ ]?pro|deepseek[-_ ]?pro|\bpro\b)/i.test(haystack)) return 'pro';
    return null;
  }

  function dateLooksToday(object) {
    const raw = stringByKey(object, [/^date$/, /day/, /time/, /timestamp/, /created/, /period/]);
    if (!raw) return null;
    const today = new Date();
    const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (raw.includes(local) || raw.includes(local.replaceAll('-', '/'))) return true;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.getFullYear() === today.getFullYear()
      && parsed.getMonth() === today.getMonth()
      && parsed.getDate() === today.getDate();
  }

  function emptyModel() {
    return { tokens: null, cost: null, cacheHitTokens: null, cacheMissTokens: null };
  }

  function aggregatePayload(payload) {
    const result = {
      flash: emptyModel(),
      pro: emptyModel(),
      totalTokens: null,
      totalCost: null,
      cacheRate: null,
      trend: [],
      score: 0
    };
    const objects = walkObjects(payload);
    const modelRows = [];

    for (const object of objects) {
      const model = modelKind(object);
      if (!model) continue;
      const todayFlag = dateLooksToday(object);
      if (todayFlag === false) continue;

      let tokens = numericByKey(object, [/^total_?tokens?$/, /^token_?count$/, /^tokens?$/, /total.*token/], [/cache/, /price/, /cost/]);
      const input = numericByKey(object, [/input.*token/, /prompt.*token/], [/cache/]);
      const output = numericByKey(object, [/output.*token/, /completion.*token/], [/cache/]);
      if (tokens == null && (input != null || output != null)) tokens = (input || 0) + (output || 0);
      const cost = numericByKey(object, [/total.*cost/, /^cost$/, /amount/, /expense/, /fee/, /charge/, /consume/], [/token/, /price/]);
      const cacheHitTokens = numericByKey(object, [/cache.*hit.*token/, /prompt.*cache.*hit/]);
      const cacheMissTokens = numericByKey(object, [/cache.*miss.*token/, /prompt.*cache.*miss/]);
      if ([tokens, cost, cacheHitTokens, cacheMissTokens].every(value => value == null)) continue;
      modelRows.push({ model, tokens, cost, cacheHitTokens, cacheMissTokens, signature: JSON.stringify(object) });
    }

    const seen = new Set();
    for (const row of modelRows) {
      if (seen.has(row.signature)) continue;
      seen.add(row.signature);
      const target = result[row.model];
      for (const key of ['tokens', 'cost', 'cacheHitTokens', 'cacheMissTokens']) {
        if (row[key] == null) continue;
        target[key] = (target[key] || 0) + row[key];
      }
    }

    for (const model of ['flash', 'pro']) {
      const item = result[model];
      if (item.tokens != null) result.totalTokens = (result.totalTokens || 0) + item.tokens;
      if (item.cost != null) result.totalCost = (result.totalCost || 0) + item.cost;
    }
    const hit = (result.flash.cacheHitTokens || 0) + (result.pro.cacheHitTokens || 0);
    const miss = (result.flash.cacheMissTokens || 0) + (result.pro.cacheMissTokens || 0);
    if (hit + miss > 0) result.cacheRate = 100 * hit / (hit + miss);

    result.score = [
      result.flash.tokens, result.flash.cost,
      result.pro.tokens, result.pro.cost,
      result.totalTokens, result.totalCost, result.cacheRate
    ].filter(value => value != null).length;
    return result;
  }

  function bestNetworkUsage() {
    let best = null;
    for (const entry of window[NETWORK_KEY] || []) {
      const candidate = aggregatePayload(entry.payload);
      candidate.networkUrl = entry.url;
      if (!best || candidate.score > best.score) best = candidate;
    }
    return best && best.score > 0 ? best : null;
  }

  function modelFromLines(lines, model) {
    const patterns = model === 'flash'
      ? [/deepseek[-_ ]?v?4[-_ ]?flash/i, /\bflash\b/i]
      : [/deepseek[-_ ]?v?4[-_ ]?pro/i, /\bpro\b/i];
    for (let i = 0; i < lines.length; i += 1) {
      if (!patterns.some(pattern => pattern.test(lines[i]))) continue;
      const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 10)).join(' | ');
      const costs = [...context.matchAll(/(?:¥|￥)\s*(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
      const tokenMatch = context.match(/(\d+(?:\.\d+)?)\s*([KMB万亿])?\s*(?:tokens?|令牌)/i);
      return {
        tokens: tokenMatch ? scaled(`${tokenMatch[1]}${tokenMatch[2] || ''}`) : null,
        cost: costs.length ? costs[costs.length - 1] : null,
        cacheHitTokens: null,
        cacheMissTokens: null
      };
    }
    return emptyModel();
  }

  function deepseek() {
    const lines = pageLines();
    const network = bestNetworkUsage();
    const balance = findMetric(lines, ['充值余额', '账户余额', 'balance', '可用余额'], money, 5);
    const todayCost = findMetric(lines, ['今日费用', '今日消耗', 'today cost', 'today usage'], money, 5);
    const todayTokens = findMetric(lines, ['今日 token', '今日tokens', 'today token', '总 token'], scaled, 5);
    const cacheRate = findMetric(lines, ['缓存命中率', 'cache hit rate', 'cache hit'], num, 5);
    const flash = network?.flash?.tokens != null || network?.flash?.cost != null ? network.flash : modelFromLines(lines, 'flash');
    const pro = network?.pro?.tokens != null || network?.pro?.cost != null ? network.pro : modelFromLines(lines, 'pro');
    const totalTokens = network?.totalTokens ?? todayTokens?.value ?? ((flash.tokens || 0) + (pro.tokens || 0) || null);
    const totalCost = network?.totalCost ?? todayCost?.value ?? ((flash.cost || 0) + (pro.cost || 0) || null);
    const rate = network?.cacheRate ?? cacheRate?.value ?? null;

    return {
      source,
      capturedAt: new Date().toISOString(),
      url: location.href,
      balance,
      todayCost: totalCost == null ? null : { value: totalCost },
      todayTokens: totalTokens == null ? null : { value: totalTokens },
      cacheRate: rate == null ? null : { value: rate },
      flash,
      pro,
      trend: network?.trend || [],
      diagnostics: {
        networkPayloads: (window[NETWORK_KEY] || []).length,
        networkScore: network?.score || 0,
        networkUrl: network?.networkUrl || null
      }
    };
  }

  function signal(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const b64 = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const pageTitle = document.title;
    document.title = `__TOKEN_ON_KINDLE__:${source}:${b64}`;
    setTimeout(() => {
      document.title = pageTitle || (source === 'codex' ? 'Codex Analytics' : 'DeepSeek Platform');
    }, 250);
  }

  function collect() {
    try {
      signal(source === 'codex' ? codex() : deepseek());
    } catch (error) {
      console.error('[Token on Kindle] collection failed', error);
    }
  }

  function returnToDashboard() {
    if (history.length > 1) {
      history.go(1 - history.length);
      return;
    }
    document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard';
  }

  function toolbar() {
    if (document.getElementById('__token_on_kindle_toolbar')) return;
    const root = document.createElement('div');
    root.id = '__token_on_kindle_toolbar';
    root.style.cssText = 'position:fixed;z-index:2147483647;right:14px;bottom:14px;padding:8px;background:white;color:black;border:2px solid black;font:13px sans-serif;display:flex;gap:6px';
    const sync = document.createElement('button');
    sync.textContent = '同步到 Kindle';
    sync.onclick = collect;
    const back = document.createElement('button');
    back.textContent = '返回看板';
    back.onclick = returnToDashboard;
    root.append(sync, back);
    document.documentElement.appendChild(root);
  }

  const start = () => {
    toolbar();
    setTimeout(collect, 3000);
    setTimeout(collect, 8000);
    setInterval(collect, 10 * 60 * 1000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
