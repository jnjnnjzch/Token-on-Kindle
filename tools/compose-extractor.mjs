import { readFile, writeFile } from 'node:fs/promises';

const extractorUrl = new URL('../web/extractor.js', import.meta.url);
const baseUrl = new URL('../web/extractor-base.js', import.meta.url);
const deepseekParserUrl = new URL('../shared/deepseek-response-parser-v2.mjs', import.meta.url);
const deepseekSummaryUrl = new URL('../shared/deepseek-summary-parser.mjs', import.meta.url);
const deepseekPlatformUrl = new URL('../shared/deepseek-platform-parser.mjs', import.meta.url);
const deepseekReaderUrl = new URL('../web/deepseek-direct-reader.js', import.meta.url);
const volcengineParserUrl = new URL('../shared/volcengine-internal-api-parser.mjs', import.meta.url);
const volcengineReaderUrl = new URL('../web/volcengine-direct-reader.js', import.meta.url);
const BASE_START = '/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR START */';
const BASE_END = '/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR END */';
const GENERATED = '/* TOKEN-ON-KINDLE DIRECT API WORKERS BUILD */';
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
        quotaCount: payload.diagnostics?.quotaCount,
        modelCount: payload.diagnostics?.modelCount,
        modelListCount: payload.diagnostics?.modelListCount,
        usageSeriesCount: payload.diagnostics?.usageSeriesCount,
        lifecycle: payload.diagnostics?.lifecycle,
        workerPage: payload.diagnostics?.workerPage
      })
    });
  };
})();`;

let canonical = lf(await readFile(baseUrl, 'utf8'));
const volcengineDomStart = canonical.indexOf("  const VOLCENGINE_WINDOWS = [");
const volcengineDomEnd = canonical.indexOf("  async function collectDeepSeek()", volcengineDomStart);
if (volcengineDomStart < 0 || volcengineDomEnd < 0) throw new Error('canonical Volcengine DOM block changed');
canonical = `${canonical.slice(0, volcengineDomStart)}${canonical.slice(volcengineDomEnd)}`;
canonical = canonical.replace(`      if (source === 'volcengine' && !volcengineUsageReady()) {
        setToolbarStatus('请进入企业版 Agent Plan → 用量统计');
        return;
      }
      const payload = source === 'codex' ? collectCodex() : source === 'deepseek' ? await collectDeepSeek() : collectVolcengine();`, `      if (source === 'volcengine') {
        setToolbarStatus('等待火山控制台接口 Worker');
        return;
      }
      const payload = source === 'codex' ? collectCodex() : await collectDeepSeek();`);
canonical = canonical.replace(
  "      if (source === 'volcengine' && !volcengineUsageReady()) return;",
  "      if (source === 'volcengine') return;"
);
canonical = canonical.replace(
  "note.textContent = source === 'volcengine' ? '进入企业版“用量统计”后点击同步' : '登录并打开用量页面后点击同步';",
  "note.textContent = source === 'volcengine' ? '登录后由控制台接口 Worker 自动同步' : '登录并打开用量页面后点击同步';"
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
      setToolbarStatus('等待 DeepSeek Platform 内部接口读取器');
    } else {
      setToolbarStatus('等待火山控制台接口 Worker；不读取 DOM 或 ECharts');
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

let volcengineParser = lf(await readFile(volcengineParserUrl, 'utf8'));
volcengineParser = volcengineParser
  .replace('export function parseVolcengineInternalApiPayloads', 'function parseVolcengineInternalApiPayloads')
  .replace('export const __volcengineInternalApiTest', 'const __volcengineInternalApiTest');
const volcengineReader = lf(await readFile(volcengineReaderUrl, 'utf8'));

const guarded = (hostname, body, assignment) => `(() => {
  if (!location.hostname.endsWith('${hostname}')) return;
${body}
  ${assignment}
})();`;
const deepseekModules = [
  guarded('deepseek.com', deepseekParser, 'window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__ = parseDeepSeekResponses;'),
  guarded('deepseek.com', deepseekSummary, 'window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__ = parseDeepSeekSummaryText;'),
  guarded('deepseek.com', deepseekPlatform, 'window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_PLATFORM__ = parseDeepSeekPlatformPayloads;')
].join('\n');
const volcengineModules = guarded(
  'volcengine.com',
  volcengineParser,
  'window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_INTERNAL_API__ = parseVolcengineInternalApiPayloads;'
);
const output = `${GENERATED}\n${signalCompactor}\n${deepseekModules}\n${volcengineModules}\n${BASE_START}\n${canonical.trim()}\n${BASE_END}\n${deepseekReader}\n${volcengineReader}\n`;

if (!output.includes('platform-internal-api')) throw new Error('DeepSeek direct reader missing');
if (!output.includes('GetAgentPlanSeatAFPUsage')) throw new Error('Volcengine AFP internal API worker missing');
if (!output.includes('GetAgentPlanSeatUsageDetails')) throw new Error('Volcengine model internal API worker missing');
if (!output.includes('v0.6.2-reload-worker')) throw new Error('Volcengine v0.6.2 lifecycle marker missing');
if (!output.includes('__TOKEN_ON_KINDLE_COMPACT_SIGNAL__')) throw new Error('compact signal transport missing');
if (!output.includes('document.title = `__TOKEN_ON_KINDLE__:${source}:${encoded}`')) throw new Error('title signal transport missing');
if (!output.includes('__TOKEN_ON_KINDLE_ACTION__:dashboard')) throw new Error('native source-window hide action missing');
if (output.includes('new MutationObserver')) throw new Error('continuous DOM observer remains active');
if (output.includes("window.addEventListener('beforeunload'")) throw new Error('close-on-reload handler remains active');
if (output.includes('hide.onclick = () => window.close()')) throw new Error('source hide button still closes the webview');
if (output.includes('__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__')) throw new Error('Volcengine ECharts parser remains in production build');
if (output.includes('__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__')) throw new Error('Volcengine ReactECharts bridge remains in production build');
if (output.includes('模型调用明细') && output.includes('getEchartsInstance')) throw new Error('Volcengine chart reader remains in production build');
if (output.includes('__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__')) throw new Error('legacy Volcengine response cache remains active');
if (output.includes('VOLCENGINE_WINDOWS') || output.includes('collectVolcengineWindow') || output.includes('volcengineUsageReady') || output.includes('volcengineModelsFromDom')) {
  throw new Error('Volcengine DOM fallback remains in production build');
}
const current = await readFile(extractorUrl, 'utf8').catch(() => '');
if (lf(current) !== output) await writeFile(extractorUrl, output);
console.log('Composed stable Codex/DeepSeek readers and Volcengine internal API worker');
