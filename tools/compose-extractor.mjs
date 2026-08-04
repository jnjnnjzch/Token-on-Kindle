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

let canonical = lf(await readFile(baseUrl, 'utf8'));
canonical = canonical.replace(
  /\n\s*installVolcengineNetworkCapture\(\);/g,
  '\n  // Volcengine reads rendered ReactECharts state; request interception stays disabled.'
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

const moduleFunction = async (url, from, to) => lf(await readFile(url, 'utf8')).replace(from, to);
const deepseekParser = await moduleFunction(deepseekParserUrl, 'export function parseDeepSeekResponses', 'function parseDeepSeekResponses');
const deepseekSummary = await moduleFunction(deepseekSummaryUrl, 'export function parseDeepSeekSummaryText', 'function parseDeepSeekSummaryText');
const deepseekPlatform = await moduleFunction(deepseekPlatformUrl, 'export function parseDeepSeekPlatformPayloads', 'function parseDeepSeekPlatformPayloads');
const deepseekReader = lf(await readFile(deepseekReaderUrl, 'utf8'));
const volcengineParser = await moduleFunction(volcengineParserUrl, 'export function parseVolcengineEchartsOption', 'function parseVolcengineEchartsOption');
let volcengineAccess = lf(await readFile(volcengineAccessUrl, 'utf8'));
volcengineAccess = volcengineAccess
  .replace('export function inspectReactEchartsFiber', 'function inspectReactEchartsFiber')
  .replace('export function readEchartsOptionFromElement', 'function readEchartsOptionFromElement');
const volcengineReader = lf(await readFile(volcengineReaderUrl, 'utf8'));

const deepseekModules = `(() => {
  if (!location.hostname.endsWith('deepseek.com')) return;
${deepseekParser}
  window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__ = parseDeepSeekResponses;
${deepseekSummary}
  window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__ = parseDeepSeekSummaryText;
${deepseekPlatform}
  window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_PLATFORM__ = parseDeepSeekPlatformPayloads;
})();`;
const volcengineModules = `(() => {
  if (!location.hostname.endsWith('volcengine.com')) return;
  window.__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__ = true;
${volcengineParser}
  window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__ = parseVolcengineEchartsOption;
${volcengineAccess}
  window.__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__ = readEchartsOptionFromElement;
})();`;
const output = `${GENERATED}\n${deepseekModules}\n${volcengineModules}\n${BASE_START}\n${canonical.trim()}\n${BASE_END}\n${deepseekReader}\n${volcengineReader}\n`;

if (!output.includes('platform-internal-api')) throw new Error('DeepSeek direct reader missing');
if (!output.includes('getEchartsInstance')) throw new Error('Volcengine direct reader missing');
if (output.includes('new MutationObserver')) throw new Error('continuous DOM observer remains active');
if (/\n\s*installVolcengineNetworkCapture\(\);/.test(output)) throw new Error('legacy Volcengine interception remains active');
const current = await readFile(extractorUrl, 'utf8').catch(() => '');
if (lf(current) !== output) await writeFile(extractorUrl, output);
console.log('Composed stable Codex, DeepSeek, and Volcengine readers');
