(() => {
  'use strict';
  if (!location.hostname.endsWith('deepseek.com') || window.__TOKEN_ON_KINDLE_CAPTURE_INSTALLED__) return;
  window.__TOKEN_ON_KINDLE_CAPTURE_INSTALLED__ = true;

  const store = window.__TOKEN_ON_KINDLE_DEEPSEEK_RESPONSES__ = window.__TOKEN_ON_KINDLE_DEEPSEEK_RESPONSES__ || [];
  let order = store.at(-1)?.order || 0;
  const CONTEXT_KEY = /(model|date|day|start|end|from|to|granularity|interval)/i;

  function relevant(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      return url.hostname.endsWith('deepseek.com')
        && (/\/api\//i.test(url.pathname) || /(usage|amount|cost|billing|consume|stat|token)/i.test(url.pathname));
    } catch {
      return false;
    }
  }

  function collectContext(value, params, depth = 0) {
    if (depth > 5 || value == null) return;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return;
      try {
        collectContext(JSON.parse(text), params, depth + 1);
        return;
      } catch { /* not JSON */ }
      try {
        const search = new URLSearchParams(text);
        for (const [key, item] of search) {
          if (CONTEXT_KEY.test(key)) params.set(key, String(item).slice(0, 160));
        }
      } catch { /* not form data */ }
      return;
    }
    if (value instanceof URLSearchParams || value instanceof FormData) {
      for (const [key, item] of value.entries()) {
        if (CONTEXT_KEY.test(key) && typeof item === 'string') params.set(key, item.slice(0, 160));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 30).forEach(item => collectContext(item, params, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (CONTEXT_KEY.test(key) && ['string', 'number'].includes(typeof item)) {
        params.set(key, String(item).slice(0, 160));
      } else if (item && typeof item === 'object') {
        collectContext(item, params, depth + 1);
      }
    }
  }

  async function requestContext(input, init) {
    const params = new URLSearchParams();
    collectContext(init?.body, params);
    if (!params.size && input instanceof Request && !/^(GET|HEAD)$/i.test(input.method)) {
      try {
        const text = await input.clone().text();
        if (text.length <= 200_000) collectContext(text, params);
      } catch { /* unreadable request body */ }
    }
    return params;
  }

  function safePath(rawUrl, requestParams = new URLSearchParams()) {
    try {
      const url = new URL(String(rawUrl || ''), location.href);
      const kept = new URLSearchParams();
      for (const [key, value] of url.searchParams) {
        if (CONTEXT_KEY.test(key)) kept.set(key, value.slice(0, 160));
      }
      for (const [key, value] of requestParams) kept.set(key, value);
      const query = kept.toString();
      return `${url.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return String(rawUrl || '').slice(0, 240);
    }
  }

  function remember(rawUrl, body, transport, requestParams) {
    if (!relevant(rawUrl) || !body || typeof body !== 'object') return;
    store.push({
      order: ++order,
      path: safePath(rawUrl, requestParams),
      transport,
      capturedAt: new Date().toISOString(),
      body
    });
    if (store.length > 30) store.splice(0, store.length - 30);
  }

  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) {
    window.fetch = async (...args) => {
      const contextPromise = requestContext(args[0], args[1]);
      const response = await originalFetch(...args);
      const rawUrl = response.url || args[0]?.url || args[0];
      if (relevant(rawUrl)) {
        Promise.all([response.clone().text(), contextPromise]).then(([text, requestParams]) => {
          if (!text || text.length > 2_000_000) return;
          try { remember(rawUrl, JSON.parse(text), 'fetch', requestParams); } catch { /* non-JSON response */ }
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
    proto.send = function(body, ...rest) {
      const requestParams = new URLSearchParams();
      collectContext(body, requestParams);
      this.addEventListener('load', () => {
        const rawUrl = this.responseURL || this.__tokenOnKindleUrl;
        if (!relevant(rawUrl)) return;
        try {
          const parsed = this.responseType === 'json' ? this.response : JSON.parse(this.responseText || '');
          remember(rawUrl, parsed, 'xhr', requestParams);
        } catch { /* non-JSON response */ }
      }, { once: true });
      return originalSend.call(this, body, ...rest);
    };
  }
})();
