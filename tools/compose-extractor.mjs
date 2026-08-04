import { readFile, writeFile } from 'node:fs/promises';

const extractorUrl = new URL('../web/extractor.js', import.meta.url);
const parserUrl = new URL('../shared/volcengine-echarts-parser.mjs', import.meta.url);
const accessUrl = new URL('../shared/volcengine-react-echarts-access.mjs', import.meta.url);
const readerUrl = new URL('../web/volcengine-chart-reader.js', import.meta.url);
const BASE_START = '/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR START */';
const BASE_END = '/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR END */';
const GENERATED = '/* TOKEN-ON-KINDLE v0.8.4 DIRECT CHART BUILD */';

let canonical = await readFile(extractorUrl, 'utf8');
if (canonical.includes(BASE_START) && canonical.includes(BASE_END)) {
  canonical = canonical.split(BASE_START)[1].split(BASE_END)[0].replace(/^\s*\n|\n\s*$/g, '');
}
const parserModule = await readFile(parserUrl, 'utf8');
const parserBrowser = parserModule
  .replace('export function parseVolcengineEchartsOption', 'function parseVolcengineEchartsOption');
const accessModule = await readFile(accessUrl, 'utf8');
const accessBrowser = accessModule
  .replace('export function inspectReactEchartsFiber', 'function inspectReactEchartsFiber')
  .replace('export function readEchartsOptionFromElement', 'function readEchartsOptionFromElement');
const reader = await readFile(readerUrl, 'utf8');
const prelude = `(() => {\n  if (location.hostname.endsWith('volcengine.com')) {\n    window.__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__ = true;\n  }\n})();`;
canonical = canonical.replace(/\n\s*installVolcengineNetworkCapture\(\);/g, '\n  // v0.8.4 reads rendered ReactECharts state; legacy request interception is disabled.');
const output = `${GENERATED}\n${prelude}\n(() => {\n${parserBrowser}\nwindow.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__ = parseVolcengineEchartsOption;\n})();\n(() => {\n${accessBrowser}\nwindow.__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__ = readEchartsOptionFromElement;\n})();\n${BASE_START}\n${canonical}\n${BASE_END}\n${reader}\n`;
await writeFile(extractorUrl, output);
console.log('Composed web/extractor.js with direct Volcengine chart reader');
