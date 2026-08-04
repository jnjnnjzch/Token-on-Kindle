import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseVolcengineEchartsOption } from '../shared/volcengine-echarts-parser.mjs';
import { readEchartsOptionFromElement } from '../shared/volcengine-react-echarts-access.mjs';
import { diagnosticSnapshot } from '../web/diagnostics.js';

const legend = [
  'deepseek-v4-flash',
  'doubao-seed-evolving',
  'minimax-m3',
  'deepseek-v4-pro-260425',
  'glm-5-2-260617',
  'kimi-k2.6'
];

test('reads every model series directly from the rendered ECharts option', () => {
  const option = {
    xAxis: [{ data: ['2026-07-29', '2026-07-30', '2026-07-31'] }],
    series: legend.map((name, index) => ({
      name,
      type: 'bar',
      stack: 'tokens',
      data: [index * 10, index * 10 + 1, { value: index * 10 + 2 }]
    }))
  };
  const result = parseVolcengineEchartsOption(option, legend, { granularity: '天' });
  assert.equal(result.models.length, 6);
  assert.equal(result.periodStart, '2026-07-29');
  assert.equal(result.periodEnd, '2026-07-31');
  assert.equal(result.granularity, '天');
  assert.equal(result.diagnostics.extractionMode, 'series');
  assert.equal(result.diagnostics.pointCount, 18);
  const pro = result.models.find(model => model.name === 'deepseek-v4-pro-260425');
  assert.equal(pro.totalTokens, 93);
  assert.equal(pro.latestTokens, 32);
});

test('supports ECharts dataset rows when series data is dataset-driven', () => {
  const option = {
    dataset: [{ source: [['date', 'deepseek-v4-flash', 'kimi-k2.6'], ['2026-08-01', 10, 2], ['2026-08-02', 15, 3]] }],
    xAxis: [{ type: 'category' }],
    series: [{ name: 'deepseek-v4-flash', type: 'bar' }, { name: 'kimi-k2.6', type: 'bar' }]
  };
  const result = parseVolcengineEchartsOption(option, ['deepseek-v4-flash', 'kimi-k2.6']);
  assert.equal(result.diagnostics.extractionMode, 'dataset');
  assert.equal(result.models.find(model => model.name === 'deepseek-v4-flash').totalTokens, 25);
  assert.equal(result.models.find(model => model.name === 'kimi-k2.6').totalTokens, 5);
});

test('keeps zero-valued legend models without inventing token points', () => {
  const result = parseVolcengineEchartsOption({ series: [] }, legend);
  assert.equal(result.models.length, 6);
  assert.equal(result.diagnostics.extractionMode, 'legend-only');
  assert.equal(result.diagnostics.pointCount, 0);
  assert.ok(result.models.every(model => model.totalTokens === 0));
});

test('walks the real React DOM fiber shape to call ReactECharts.getEchartsInstance()', () => {
  const option = { series: [{ name: 'kimi-k2.6', data: [3, 5] }] };
  const component = { stateNode: { getEchartsInstance: () => ({ getOption: () => option }) }, return: null, alternate: null };
  const host = { stateNode: {}, return: component, alternate: null };
  const chart = { parentElement: null };
  Object.defineProperty(chart, '__reactFiber$productionSuffix', { value: host });
  const result = readEchartsOptionFromElement(chart, null);
  assert.equal(result.method, 'react-component');
  assert.equal(result.option, option);
});

test('uses the official global ECharts instance when the page exposes it', () => {
  const option = { dataset: [{ source: [['date', 'm'], ['2026-08-04', 7]] }] };
  const chart = { parentElement: null };
  const result = readEchartsOptionFromElement(chart, { getInstanceByDom: element => element === chart ? { getOption: () => option } : null });
  assert.equal(result.method, 'echarts-global');
  assert.equal(result.option, option);
});

test('Volcengine overlay reads ReactECharts state without intercepting page requests', async () => {
  const reader = await readFile(new URL('../web/volcengine-chart-reader.js', import.meta.url), 'utf8');
  const access = await readFile(new URL('../shared/volcengine-react-echarts-access.mjs', import.meta.url), 'utf8');
  const built = await readFile(new URL('../web/extractor.js', import.meta.url), 'utf8');
  assert.match(access, /getEchartsInstance/);
  assert.match(access, /react-component/);
  assert.match(reader, /__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__/);
  assert.match(reader, /modelChart: chart\.diagnostics/);
  assert.doesNotMatch(reader, /window\.fetch\s*=/);
  assert.doesNotMatch(reader, /XMLHttpRequest/);
  assert.doesNotMatch(reader, /MutationObserver/);
  assert.match(reader, /lastGoodChart/);
  assert.match(reader, /\[1200, 3200, 6500\]/);
  assert.match(built, /TOKEN-ON-KINDLE DIRECT READERS BUILD/);
  assert.match(built, /__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__/);
  assert.doesNotMatch(built, /new MutationObserver/);
  const guard = built.indexOf('__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__ = true');
  assert.ok(guard >= 0, 'Volcengine capture guard must be installed before canonical code');
  assert.doesNotMatch(built, /\n\s*installVolcengineNetworkCapture\(\);/);
});

test('diagnostic JSON preserves model names, tokens and direct chart access details', () => {
  const snapshot = diagnosticSnapshot('volcengine', {
    source: 'volcengine',
    capturedAt: '2026-08-04T06:21:34.930Z',
    plan: 'Agent Plan 企业版',
    unit: 'AFP',
    windows: [],
    models: [{ name: 'kimi-k2.6', totalTokens: 1234, pointCount: 7 }],
    modelUsage: { source: 'react-component', periodStart: '2026-07-29', periodEnd: '2026-08-04', granularity: '天' },
    diagnostics: { modelUsageSource: 'react-component', modelCount: 1, modelChart: { chartCount: 1, accessMethod: 'react-component', legendNames: ['kimi-k2.6'], parser: { seriesCount: 1, pointCount: 7, extractionMode: 'series' } } }
  });
  assert.equal(snapshot.models[0].name, 'kimi-k2.6');
  assert.equal(snapshot.models[0].totalTokens, 1234);
  assert.equal(snapshot.modelUsage.source, 'react-component');
  assert.equal(snapshot.diagnostics.modelChart.accessMethod, 'react-component');
  assert.equal(snapshot.diagnostics.modelChart.parser.extractionMode, 'series');
});
