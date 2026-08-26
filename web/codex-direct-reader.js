(() => {
  'use strict';
  if (location.hostname !== 'chatgpt.com' || window.__TOKEN_ON_KINDLE_CODEX_ADAPTIVE_READER__) return;
  window.__TOKEN_ON_KINDLE_CODEX_ADAPTIVE_READER__ = 'codex-adaptive-v0.9.16';

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const finite = value => {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const match = String(value).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const state = {
    collecting: false,
    lastPayload: null,
    closeTimer: null
  };

  function applySyncOptions(options = {}) {
    const refreshMinutes = finite(options.refreshMinutes ?? options.refresh_minutes);
    if (refreshMinutes != null) sessionStorage.setItem('__token_on_kindle_refresh_minutes', String(refreshMinutes));
    if (options.syncRequestedAt) sessionStorage.setItem('__token_on_kindle_sync_requested_at', String(options.syncRequestedAt));
  }

  function encodeSignal(payload) {
    const refreshMinutes = finite(sessionStorage.getItem('__token_on_kindle_refresh_minutes'));
    const syncRequestedAt = sessionStorage.getItem('__token_on_kindle_sync_requested_at') || null;
    const compact = window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__?.('codex', {
      ...payload,
      updateIntervalMinutes: refreshMinutes,
      syncRequestedAt
    }) || payload;
    const bytes = new TextEncoder().encode(JSON.stringify(compact));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  function signal(payload) {
    const previousTitle = document.title;
    document.title = `__TOKEN_ON_KINDLE__:codex:${encodeSignal(payload)}`;
    setTimeout(() => {
      if (document.title.startsWith('__TOKEN_ON_KINDLE__:')) {
        document.title = previousTitle || 'Codex Analytics';
      }
    }, 300);
  }

  function quotaKind(text) {
    const value = clean(text);
    if (/(weekly|per\s+week|week(?:ly)?\s+limit|7[- ]?day|本周|每周|周额度|周限制)/i.test(value)) return 'weekly';
    const hours = value.match(/(\d+(?:\.\d+)?)\s*(?:(?:[-\s]*(?:hours?|hrs?)|h)\b|小时)/i);
    if (hours) return `${hours[1]}h`;
    if (/(daily|day\s+limit|today|今日|每天|日额度|日限制)/i.test(value)) return 'daily';
    if (/(monthly|month\s+limit|本月|每月|月额度|月限制)/i.test(value)) return 'monthly';
    return 'unknown';
  }

  function resetText(text) {
    const value = clean(text);
    const patterns = [
      /(?:next\s+reset|resets?|renewal|renews?)\s*(?:in|at|on)?\s*[:：]?\s*([^|%]{1,80})/i,
      /(?:下次重置|重置时间|重置于|恢复于|刷新于)\s*[:：]?\s*([^|%]{1,80})/i,
      /([^|%]{1,64}?(?:后重置|后恢复|后刷新))/i
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (!match) continue;
      let result = clean(match[1]);
      result = result.replace(/\s+(?:weekly|\d+(?:\.\d+)?\s*(?:h|hours?|hrs?)|limit|quota|额度|限制)\b.*$/i, '').trim();
      if (result) return result.slice(0, 80);
    }
    return null;
  }

  function percentInfo(text, preferredValue = null) {
    const value = clean(text);
    const rules = [
      ['remaining', /(?:remaining|left|available|剩余|可用)[^\d%]{0,28}(\d+(?:\.\d+)?)\s*%/i],
      ['remaining', /(\d+(?:\.\d+)?)\s*%\s*(?:remaining|left|available|剩余|可用)/i],
      ['used', /(?:used|usage|consumed|已用|已使用|消耗)[^\d%]{0,28}(\d+(?:\.\d+)?)\s*%/i],
      ['used', /(\d+(?:\.\d+)?)\s*%\s*(?:used|usage|consumed|已用|已使用|消耗)/i]
    ];
    for (const [kind, pattern] of rules) {
      const match = value.match(pattern);
      if (!match) continue;
      const parsed = finite(match[1]);
      if (parsed != null && parsed >= 0 && parsed <= 100) return { value: parsed, kind, semantic: true };
    }
    const generic = preferredValue ?? finite(value.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]);
    if (generic == null || generic < 0 || generic > 100) return null;
    let kind = null;
    if (/(remaining|left|available|剩余|可用)/i.test(value)) kind = 'remaining';
    else if (/(used|usage|consumed|已用|已使用|消耗)/i.test(value)) kind = 'used';
    return { value: generic, kind, semantic: Boolean(kind) };
  }

  function quotaFromContext(context, preferredValue = null) {
    const id = quotaKind(context);
    if (id === 'unknown') return null;
    const percent = percentInfo(context, preferredValue);
    if (!percent) return null;
    const remainingPercent = percent.kind === 'remaining' ? percent.value
      : percent.kind === 'used' ? 100 - percent.value
      : null;
    const usedPercent = percent.kind === 'used' ? percent.value
      : percent.kind === 'remaining' ? 100 - percent.value
      : null;
    const reset = resetText(context);
    return {
      id,
      displayedPercent: percent.value,
      remainingPercent,
      usedPercent,
      resetText: reset,
      _score: 10 + (percent.semantic ? 8 : 0) + (reset ? 10 : 0)
    };
  }

  function mergeQuota(current, next) {
    if (!current) return next;
    const primary = (next._score || 0) >= (current._score || 0) ? next : current;
    const secondary = primary === next ? current : next;
    return {
      ...secondary,
      ...primary,
      remainingPercent: primary.remainingPercent ?? secondary.remainingPercent ?? null,
      usedPercent: primary.usedPercent ?? secondary.usedPercent ?? null,
      resetText: primary.resetText || secondary.resetText || null,
      _score: Math.max(primary._score || 0, secondary._score || 0)
    };
  }

  function addQuota(byId, quota) {
    if (!quota) return;
    byId.set(quota.id, mergeQuota(byId.get(quota.id), quota));
  }

  function pageLines() {
    const text = document.body?.innerText || '';
    return text.split(/\r?\n+/).map(clean).filter(Boolean).slice(0, 6000);
  }

  function collectFromLines(byId) {
    const lines = pageLines();
    for (let index = 0; index < lines.length; index += 1) {
      const id = quotaKind(lines[index]);
      if (id === 'unknown') continue;
      let end = Math.min(lines.length, index + 10);
      for (let cursor = index + 1; cursor < end; cursor += 1) {
        const nextId = quotaKind(lines[cursor]);
        if (nextId !== 'unknown' && nextId !== id) {
          end = cursor;
          break;
        }
      }
      const context = lines.slice(Math.max(0, index - 1), end).join(' | ');
      const quota = quotaFromContext(context);
      if (quota && quota.id === id) addQuota(byId, quota);
    }
  }

  function collectFromProgress(byId) {
    const elements = document.querySelectorAll('[role="progressbar"], [aria-valuenow], [aria-valuetext]');
    for (const element of elements) {
      const own = clean(element.getAttribute('aria-valuetext') || element.getAttribute('aria-valuenow') || element.textContent || '');
      const preferredValue = finite(own);
      let node = element;
      let context = own;
      for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
        const text = clean(node.innerText || node.textContent || '');
        if (!text || text.length > 1000) continue;
        context = text;
        if (quotaKind(text) !== 'unknown' && /(%|remaining|left|available|used|usage|reset|renew|剩余|已用|重置|恢复)/i.test(text)) break;
      }
      addQuota(byId, quotaFromContext(context, preferredValue));
    }
  }

  function collectOnce() {
    const byId = new Map();
    collectFromLines(byId);
    collectFromProgress(byId);
    const quotas = [...byId.values()]
      .map(({ _score, ...quota }) => quota)
      .sort((a, b) => {
        if (a.id === 'weekly') return -1;
        if (b.id === 'weekly') return 1;
        const ah = finite(a.id);
        const bh = finite(b.id);
        if (ah != null && bh != null) return ah - bh;
        return a.id.localeCompare(b.id);
      });
    return {
      source: 'codex',
      capturedAt: new Date().toISOString(),
      quotas,
      url: location.href,
      diagnostics: {
        primarySource: 'adaptive-usage-text',
        lifecycle: 'short-lived-hidden-worker',
        quotaCount: quotas.length
      }
    };
  }

  async function collectWithRetry(manual) {
    const attempts = manual ? 5 : 4;
    let payload = collectOnce();
    for (let attempt = 1; attempt < attempts && !payload.quotas.length; attempt += 1) {
      await sleep(attempt === 1 ? 450 : 900);
      payload = collectOnce();
    }
    return payload;
  }

  function toolbarStatus(message, stateName = '') {
    const note = document.querySelector('#__token_on_kindle_status');
    if (!note) return;
    note.textContent = message;
    note.dataset.state = stateName;
  }

  function scheduleHiddenClose(delay = 700) {
    if (document.visibilityState !== 'hidden') return;
    if (state.closeTimer) clearTimeout(state.closeTimer);
    state.closeTimer = setTimeout(() => {
      state.closeTimer = null;
      if (document.visibilityState !== 'hidden') return;
      try { window.close(); } catch { /* native WebView may already be gone */ }
    }, delay);
  }

  async function directSync(options = {}) {
    if (state.collecting) return state.lastPayload;
    state.collecting = true;
    applySyncOptions(options);
    toolbarStatus('正在读取 Codex 额度与重置时间…');
    try {
      const payload = await collectWithRetry(Boolean(options.manual));
      state.lastPayload = payload;
      signal(payload);
      if (payload.quotas.length) {
        toolbarStatus('已发送 Codex 动态额度与重置时间', 'success');
      } else {
        toolbarStatus('未读到额度；请确认已登录并打开 Usage / Analytics', 'warning');
      }
      if (!options.manual) scheduleHiddenClose(payload.quotas.length ? 650 : 1200);
      return payload;
    } finally {
      state.collecting = false;
    }
  }

  function installToolbarOverride() {
    const buttons = [...document.querySelectorAll('#__token_on_kindle_toolbar button')];
    const sync = buttons.find(element => clean(element.textContent) === '同步至 Kindle');
    if (sync && sync.dataset.codexAdaptive !== 'true') {
      sync.dataset.codexAdaptive = 'true';
      sync.onclick = () => directSync({ manual: true });
    }
    const hide = buttons.find(element => clean(element.textContent) === '隐藏窗口');
    if (hide && hide.dataset.codexAdaptive !== 'true') {
      hide.dataset.codexAdaptive = 'true';
      hide.onclick = () => {
        try { window.close(); } catch {
          document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard';
        }
      };
    }
  }

  function start() {
    window.__TOKEN_ON_KINDLE_SYNC__ = directSync;
    installToolbarOverride();
  }

  window.__TOKEN_ON_KINDLE_SYNC__ = directSync;
  window.addEventListener('pageshow', start, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') installToolbarOverride();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
