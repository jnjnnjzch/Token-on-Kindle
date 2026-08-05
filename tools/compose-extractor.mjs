import { readFile, writeFile } from 'node:fs/promises';

const extractorUrl = new URL('../web/extractor.js', import.meta.url);
const baseUrl = new URL('../web/extractor-base.js', import.meta.url);
const deepseekParserUrl = new URL('../shared/deepseek-response-parser-v2.mjs', import.meta.url);
const deepseekSummaryUrl = new URL('../shared/deepseek-summary-parser.mjs', import.meta.url);
const deepseekPlatformUrl = new URL('../shared/deepseek-platform-parser.mjs', import.meta.url);
const deepseekReaderUrl = new URL('../web/deepseek-direct-reader.js', import.meta.url);
const volcengineParserUrl = new URL('../shared/volcengine-echarts-parser.mjs', import.meta.url);
const volcengineAccessUrl = new URL('../shared/volcengine-react-echarts-access.mjs', import.meta.url);
const volcengineReaderUrl = new URL('../web/volcengine-chart-reader.js', import.meta.url);
const BASE_START = '/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR START */';
const BASE_END = '/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR END */';
const GENERATED = '/* TOKEN-ON-KINDLE DIRECT READERS BUILD */';
const lf = value => value.replaceAll('\r\n', '\n');

const signalCompactor = `(() => {
  'use strict';
  const defined = object => Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== undefined));
  const compactDeepSeekModel = model => model ? defined({
    name: model.name,
    date: model.date,
    tokens: model.tokens,
    cost: model.cost,
    cacheHitTokens: model.cacheHitTokens,
    cacheMissTokens: model.cacheMissTokens,
    outputTokens: model.outputTokens,
    cacheRate: model.cacheRate,
    requests: model.requests
  }) : null;
  const compactVolcengineModel = model => model ? defined({
    id: model.id,
    name: model.name,
    totalTokens: model.totalTokens ?? model.tokens,
    latestTokens: model.latestTokens,
    peakTokens: model.peakTokens,
    pointCount: model.pointCount,
    inputTokens: model.inputTokens,
    outputTokens: model.outputTokens,
    cachedTokens: model.cachedTokens,
    requests: model.requests,
    afp: model.afp
  }) : null;

  window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__ = (source, payload = {}) => {
    const common = defined({
      source,
      capturedAt: payload.capturedAt,
      updateIntervalMinutes: payload.updateIntervalMinutes,
      syncRequestedAt: payload.syncRequestedAt
    });
    if (source === 'codex') {
      return defined({
        ...common,
        account: payload.account,
        quotas: Array.isArray(payload.quotas) ? payload.quotas : []
      });
    }
    if (source === 'deepseek') {
      return defined({
        ...common,
        balance: payload.balance,
        date: payload.date,
        todayCost: payload.todayCost,
        todayTokens: payload.todayTokens,
        todayRequests: payload.todayRequests,
        cacheRate: payload.cacheRate,
        models: {
          flash: compactDeepSeekModel(payload.models?.flash),
          pro: compactDeepSeekModel(payload.models?.pro)
        },
        account: payload.account,
        range: payload.range,
        diagnostics: defined({
          primarySource: payload.diagnostics?.primarySource,
          directError: payload.diagnostics?.directError
        })
      });
    }
    return defined({
      ...common,
      plan: payload.plan,
      unit: payload.unit,
      windows: Array.isArray(payload.windows) ? payload.windows : [],
      models: Array.isArray(payload.models) ? payload.models.map(compactVolcengineModel).filter(Boolean) : [],
      modelUsage: payload.modelUsage ? defined({
        source: payload.modelUsage.source,
        periodStart: payload.modelUsage.periodStart,
        periodEnd: payload.modelUsage.periodEnd,
        granularity: payload.modelUsage.granularity
      }) : undefined,
      diagnostics: defined({
        primarySource: payload.diagnostics?.primarySource,
        instruction: payload.diagnostics?.instruction,
        quotaCount: payload.diagnostics?.quotaCount,
        usageViewReady: payload.diagnostics?.usageViewReady,
        modelUsageSource: payload.diagnostics?.modelUsageSource,
        modelCount: payload.diagnostics?.modelCount
      })
    });
  };
})();`;

let canonical = lf(await readFile(baseUrl, 'utf8'));
canonical = canonical.replace(
  /\n\s*installVolcengineNetworkCapture\(\);/g,
  '\n  // Volcengine reads rendered ReactECharts state; request interception stays disabled.'
);
canonical = canonical.replace(`  window.addEventListener('beforeunload', () => {
    if (!document.hasFocus()) {
      try { window.close(); } catch { /* native window guard */ }
    }
  });

`, '');
canonical = canonical.replace(
  "JSON.stringify({ ...payload, updateIntervalMinutes: syncState.refreshMinutes, syncRequestedAt: syncState.syncRequestedAt })",
  "JSON.stringify(window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__?.(source, { ...payload, updateIntervalMinutes: syncState.refreshMinutes, syncRequestedAt: syncState.syncRequestedAt }) || payload)"
);
canonical = canonical.replace(
  'hide.onclick = () => window.close();',
  "hide.onclick = () => { document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard'; };"
);
canonical = canonical.replace(
  "setToolbarStatus(options.manual ? '已同步至 Kindle' : '后台同步完成', 'success');",
  "setToolbarStatus(options.manual ? '已发送至主程序，主界面收到后会更新' : '后台数据已发送', 'success');"
);
const observerStart = canonical.indexOf("  let autoCapturedView = '';");
if (observerStart >= 0) {
  const readyHandler = canonical.indexOf("\n\n  if (document.readyState === 'loading')", observerStart);
  if (readyHandler < 0) throw new Error('canonical extractor ready handler changed');
  const stableStart = `  function start() {
    toolbar();
    if (source === 'codex') {
      setTimeout(() => collectAndSignal({ automatic: true }), 2500);
      setTimeout(() => collectAndSignal({ automatic: true }), 7000);
    } else if (source === 'deepseek') {
      setToolbarStatus('等待 DeepSeek Platform 直读器同步余额与模型明细');
    } else {
      setToolbarStatus('等待企业版用量页面；轻量图表读取器将在页面就绪后同步');
    }
  }`;
  canonical = `${canonical.slice(0, observerStart)}${stableStart}${canonical.slice(readyHandler)}`;
}
if (canonical.includes('new MutationObserver')) throw new Error('canonical extractor observer shape changed');
if (canonical.includes("window.addEventListener('beforeunload'")) throw new Error('background close-on-reload handler remains active');
if (canonical.includes('hide.onclick = () => window.close()')) throw new Error('source hide button still closes the webview');

const moduleFunction = async (url, from, to) => lf(await readFile(url, 'utf8')).replace(from, to);
const deepseekParser = await moduleFunction(deepseekParserUrl, 'export function parseDeepSeekResponses', 'function parseDeepSeekResponses');
const deepseekSummary = await moduleFunction(deepseekSummaryUrl, 'export function parseDeepSeekSummaryText', 'function parseDeepSeekSummaryText');
const deepseekPlatform = await moduleFunction(deepseekPlatformUrl, 'export function parseDeepSeekPlatformPayloads', 'function parseDeepSeekPlatformPayloads');
let deepseekReader = lf(await readFile(deepseekReaderUrl, 'utf8'));
deepseekReader = deepseekReader
  .replace(
    'JSON.stringify({ ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt })',
    "JSON.stringify(window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__?.('deepseek', { ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt }) || payload)"
  )
  .replace(
    '    document.title = `__TOKEN_ON_KINDLE__:deepseek:${encodeSignal(payload)}`;',
    "    const encoded = encodeSignal(payload);\n    document.title = `__TOKEN_ON_KINDLE__:deepseek:${encoded}`;"
  )
  .replace(
    "status('已同步余额、Flash/Pro Token 与缓存明细', 'success');",
    "status('已发送余额、Flash/Pro Token 与缓存明细', 'success');"
  );
const volcengineParser = await moduleFunction(volcengineParserUrl, 'export function parseVolcengineEchartsOption', 'function parseVolcengineEchartsOption');
let volcengineAccess = lf(await readFile(volcengineAccessUrl, 'utf8'));
volcengineAccess = volcengineAccess
  .replace('export function inspectReactEchartsFiber', 'function inspectReactEchartsFiber')
  .replace('export function readEchartsOptionFromElement', 'function readEchartsOptionFromElement');
let volcengineReader = lf(await readFile(volcengineReaderUrl, 'utf8'));
volcengineReader = volcengineReader
  .replace(
    'JSON.stringify({ ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt })',
    "JSON.stringify(window.__TOKEN_ON_KINDLE_COMPACT_SIGNAL__?.('volcengine', { ...payload, updateIntervalMinutes: refreshMinutes, syncRequestedAt }) || payload)"
  )
  .replace(
    '    document.title = `__TOKEN_ON_KINDLE__:volcengine:${encodeSignal(payload)}`;',
    "    const encoded = encodeSignal(payload);\n    document.title = `__TOKEN_ON_KINDLE__:volcengine:${encoded}`;"
  )
  .replace('`已同步 AFP 与 ${chart.models.length} 个模型`', '`已发送 AFP 与 ${chart.models.length} 个模型`')
  .replace("'已同步 AFP；模型图表尚未就绪'", "'已发送 AFP；模型图表尚未就绪'");

const guarded = (body, assignment) => `(() => {
  if (!location.hostname.endsWith('deepseek.com')) return;
${body}
  ${assignment}
})();`;
const deepseekModules = [
  guarded(deepseekParser, 'window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__ = parseDeepSeekResponses;'),
  guarded(deepseekSummary, 'window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__ = parseDeepSeekSummaryText;'),
  guarded(deepseekPlatform, 'window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_PLATFORM__ = parseDeepSeekPlatformPayloads;')
].join('\n');
const volcengineModules = `(() => {
  if (!location.hostname.endsWith('volcengine.com')) return;
  window.__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__ = true;
${volcengineParser}
  window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__ = parseVolcengineEchartsOption;
${volcengineAccess}
  window.__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__ = readEchartsOptionFromElement;
})();`;
const output = `${GENERATED}\n${signalCompactor}\n${deepseekModules}\n${volcengineModules}\n${BASE_START}\n${canonical.trim()}\n${BASE_END}\n${deepseekReader}\n${volcengineReader}\n`;

if (!output.includes('platform-internal-api')) throw new Error('DeepSeek direct reader missing');
if (!output.includes('getEchartsInstance')) throw new Error('Volcengine direct reader missing');
if (!output.includes('__TOKEN_ON_KINDLE_COMPACT_SIGNAL__')) throw new Error('compact signal transport missing');
if (!output.includes('document.title = `__TOKEN_ON_KINDLE__:${source}:${encoded}`')) throw new Error('title signal transport missing');
if (output.includes('__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__')) throw new Error('navigation bridge unexpectedly restored');
if (output.includes('token-on-kindle.invalid')) throw new Error('navigation bridge host unexpectedly restored');
if (!output.includes('__TOKEN_ON_KINDLE_ACTION__:dashboard')) throw new Error('native source-window hide action missing');
if (output.includes('new MutationObserver')) throw new Error('continuous DOM observer remains active');
if (output.includes("window.addEventListener('beforeunload'")) throw new Error('close-on-reload handler remains active');
if (output.includes('hide.onclick = () => window.close()')) throw new Error('source hide button still closes the webview');
if (/\n\s*installVolcengineNetworkCapture\(\);/.test(output)) throw new Error('legacy Volcengine interception remains active');
const current = await readFile(extractorUrl, 'utf8').catch(() => '');
if (lf(current) !== output) await writeFile(extractorUrl, output);
console.log('Composed stable compact Codex, DeepSeek, and Volcengine readers');
