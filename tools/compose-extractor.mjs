import { readFile, writeFile } from 'node:fs/promises';

const extractorUrl = new URL('../web/extractor.js', import.meta.url);
const parserUrl = new URL('../shared/volcengine-echarts-parser.mjs', import.meta.url);
const accessUrl = new URL('../shared/volcengine-react-echarts-access.mjs', import.meta.url);
const readerUrl = new URL('../web/volcengine-chart-reader.js', import.meta.url);
const BASE_START = '/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR START */';
const BASE_END = '/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR END */';
const GENERATED = '/* TOKEN-ON-KINDLE DIRECT CHART BUILD */';

let canonical = await readFile(extractorUrl, 'utf8');
if (canonical.includes(BASE_START) && canonical.includes(BASE_END)) {
  canonical = canonical.split(BASE_START)[1].split(BASE_END)[0].replace(/^\s*\n|\n\s*$/g, '');
}

canonical = canonical.replace(
  /\n\s*installVolcengineNetworkCapture\(\);/g,
  '\n  // Volcengine reads the rendered ReactECharts state; request interception stays disabled.'
);

const observerStart = canonical.indexOf("  let autoCapturedView = '';");
if (observerStart >= 0) {
  const readyHandler = canonical.indexOf("\n\n  if (document.readyState === 'loading')", observerStart);
  if (readyHandler < 0) throw new Error('canonical extractor ready handler changed');
  const stableStart = `  function start() {
    toolbar();
    if (source !== 'volcengine') {
      setTimeout(() => collectAndSignal({ automatic: true }), 2500);
      setTimeout(() => collectAndSignal({ automatic: true }), 7000);
    } else {
      setToolbarStatus('等待企业版用量页面；轻量图表读取器将在页面就绪后同步');
    }
  }`;
  canonical = `${canonical.slice(0, observerStart)}${stableStart}${canonical.slice(readyHandler)}`;
} else if (canonical.includes('new MutationObserver')) {
  throw new Error('canonical extractor observer shape changed');
}

const parserModule = await readFile(parserUrl, 'utf8');
const parserBrowser = parserModule
  .replace('export function parseVolcengineEchartsOption', 'function parseVolcengineEchartsOption');
const accessModule = await readFile(accessUrl, 'utf8');
const accessBrowser = accessModule
  .replace('export function inspectReactEchartsFiber', 'function inspectReactEchartsFiber')
  .replace('export function readEchartsOptionFromElement', 'function readEchartsOptionFromElement');
const reader = await readFile(readerUrl, 'utf8');
const volcengineModules = `(() => {
  if (!location.hostname.endsWith('volcengine.com')) return;
  window.__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__ = true;
${parserBrowser}
  window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__ = parseVolcengineEchartsOption;
${accessBrowser}
  window.__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__ = readEchartsOptionFromElement;
})();`;
const output = `${GENERATED}\n${volcengineModules}\n${BASE_START}\n${canonical}\n${BASE_END}\n${reader}\n`;
const current = await readFile(extractorUrl, 'utf8').catch(() => '');
if (current !== output) await writeFile(extractorUrl, output);
console.log('Composed stable extractor with direct Volcengine chart reader');
