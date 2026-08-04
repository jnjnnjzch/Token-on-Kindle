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
    const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt }));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  function signal(payload) {
    const title = document.title;
    document.title = `__TOKEN_ON_KINDLE__:deepseek:${encodeSignal(payload)}`;
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
      status('已同步余额、Flash/Pro Token 与缓存明细', 'success');
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
