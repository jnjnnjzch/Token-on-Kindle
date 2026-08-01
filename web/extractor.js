(() => {
  'use strict';
  if (window.__TOKEN_ON_KINDLE_INSTALLED__) return;
  window.__TOKEN_ON_KINDLE_INSTALLED__ = true;

  const host = location.hostname;
  const source = host === 'chatgpt.com' ? 'codex' : host.endsWith('deepseek.com') ? 'deepseek' : null;
  if (!source) return;

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
  const pageLines = () => clean(document.body?.innerText || '')
    .split(/\n+/)
    .map(clean)
    .filter(Boolean);
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

  const money = text => {
    const match = String(text).replaceAll(',', '').match(/(?:¥|￥|\$|CNY|RMB|USD)\s*(-?\d+(?:\.\d+)?)/i)
      || String(text).replaceAll(',', '').match(/(-?\d+(?:\.\d+)?)\s*(?:元|美元)/i);
    return match ? Number(match[1]) : null;
  };
  const findMetric = (lines, labels, parser) => {
    for (let i = 0; i < lines.length; i += 1) {
      if (!labels.some(label => lines[i].toLowerCase().includes(label.toLowerCase()))) continue;
      const context = lines.slice(i, Math.min(lines.length, i + 4)).join(' ');
      const value = parser(context);
      if (value != null) return { value, text: context };
    }
    return null;
  };
  function deepseek() {
    const lines = pageLines();
    return {
      source,
      capturedAt: new Date().toISOString(),
      url: location.href,
      balance: findMetric(lines, ['balance', '余额', '可用余额'], money),
      todayCost: findMetric(lines, ['today cost', 'today usage', '今日消耗', '今日费用'], money),
      monthCost: findMetric(lines, ['this month', 'monthly cost', '本月消耗', '本月费用'], money),
      todayTokens: findMetric(lines, ['today token', '今日 token', '今日tokens'], scaled),
      monthTokens: findMetric(lines, ['month token', 'monthly token', '本月 token', '本月tokens'], scaled),
      cacheRate: findMetric(lines, ['cache hit', '缓存命中'], num)
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
    setTimeout(collect, 2500);
    setInterval(collect, 10 * 60 * 1000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
