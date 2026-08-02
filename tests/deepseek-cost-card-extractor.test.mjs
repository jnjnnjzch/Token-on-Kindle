import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');

test('range cost falls back from the numeric value node to the full card text', () => {
  assert.match(extractor, /card\.innerText[\s\S]*method: 'card-inner-text'/);
  assert.match(extractor, /card\.textContent[\s\S]*method: 'card-text-content'/);
  assert.doesNotMatch(extractor, /const raw = clean\(valueElement\?\.textContent \|\| text\)/);
});

test('Cost uses an exact label so Total cost cannot be selected as the range cost', () => {
  assert.match(extractor, /const exactOnly = normalized\.some\(label => \['cost', '费用', '消耗'\]\.includes\(label\)\)/);
  assert.match(extractor, /exactMetricLabels\(labels, card\)/);
  assert.match(extractor, /metricFromLabelAncestor\(labels, parser\)/);
});

test('Chinese selected-range labels are supported without accepting 今日消耗', () => {
  const aliases = extractor.match(/const exactOnly = normalized\.some\(label => \[(.*?)\]\.includes\(label\)\)/)?.[1] || '';
  assert.match(aliases, /'费用'/);
  assert.match(aliases, /'消耗'/);
  assert.doesNotMatch(aliases, /今日消耗|总消耗|累计消耗/);
  assert.match(extractor, /cardMetric\(\['cost', '费用', '消耗'\], money\)/);
});
