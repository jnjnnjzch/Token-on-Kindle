import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const TEMPLATE_KEY = '__token_on_kindle_volcengine_api_templates_v1';
const actions = [
  'GetAgentPlanSeatAFPUsage',
  'ListAgentPlanUsageDetailObjects',
  'GetAgentPlanSeatUsageDetails'
];

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

class MockXhr {
  addEventListener() {}
  open() {}
  send() {}
  setRequestHeader() {}
}

test('worker reload directly calls the three captured read-only APIs', async () => {
  const source = await readFile(new URL('../web/volcengine-direct-reader.js', import.meta.url), 'utf8');
  const templates = Object.fromEntries(actions.map(action => [action, {
    action,
    url: `https://console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/${action}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': 'csrf', 'x-web-id': 'web' },
    body: action === 'GetAgentPlanSeatAFPUsage'
      ? JSON.stringify({ SeatIDs: ['seat'] })
      : JSON.stringify({
          SeatIDs: ['seat'],
          Filter: { StartTime: '2026-08-01', EndTime: '2026-08-07', ObjectName: ['model-a'] },
          QueryInterval: 'Day'
        })
  }]));
  const calls = [];
  const titles = [];
  const location = {
    hostname: 'console.volcengine.com',
    pathname: '/robots.txt',
    hash: '#token-on-kindle-api-worker',
    href: 'https://console.volcengine.com/robots.txt#token-on-kindle-api-worker',
    reload() { throw new Error('startup worker must not reload recursively'); },
    replace(url) { throw new Error(`unexpected bootstrap navigation: ${url}`); }
  };
  const sessionStorage = storage({ [TEMPLATE_KEY]: JSON.stringify(templates) });
  const document = {
    readyState: 'complete',
    body: { innerHTML: '' },
    documentElement: { lang: '' },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  let title = '';
  Object.defineProperty(document, 'title', {
    get: () => title,
    set: value => { title = String(value); titles.push(title); }
  });

  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const action = actions.find(item => String(url).endsWith(`/${item}`));
    assert.ok(action);
    const body = action === 'GetAgentPlanSeatAFPUsage'
      ? { Result: { SeatAFPUsages: [{
          AFPFiveHour: { Quota: 4000, Used: 0 },
          AFPWeekly: { Quota: 14000, Used: 500 },
          AFPMonthly: { Quota: 40000, Used: 500 }
        }] } }
      : action === 'ListAgentPlanUsageDetailObjects'
        ? { Result: { Data: [{ RespModelID: 'model-a' }] } }
        : { Result: { UsageResults: [] } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const context = {
    console,
    URL,
    Headers,
    Response,
    TextEncoder,
    XMLHttpRequest: MockXhr,
    location,
    sessionStorage,
    document,
    fetch,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    setTimeout,
    clearTimeout
  };
  context.window = context;
  context.window.addEventListener = () => {};
  context.window.fetch = fetch;
  context.window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_INTERNAL_API__ = () => ({
    source: 'volcengine',
    capturedAt: '2026-08-07T00:00:00Z',
    plan: 'Agent Plan 企业版',
    unit: 'AFP',
    windows: [
      { id: '5h', total: 4000, used: 0 },
      { id: 'weekly', total: 14000, used: 500 },
      { id: 'monthly', total: 40000, used: 500 }
    ],
    models: [{ name: 'model-a', totalTokens: 1, latestTokens: 1 }],
    diagnostics: { primarySource: 'console-internal-api' }
  });

  vm.runInNewContext(source, context, { filename: 'volcengine-direct-reader.js' });
  await new Promise(resolve => setTimeout(resolve, 500));

  assert.deepEqual(calls.map(call => actions.find(action => call.url.endsWith(`/${action}`))).sort(), [...actions].sort());
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.init.credentials, 'include');
    assert.equal(call.init.cache, 'no-store');
  }
  assert.ok(titles.some(value => value.startsWith('__TOKEN_ON_KINDLE__:volcengine:')));
});
