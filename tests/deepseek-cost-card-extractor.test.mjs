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
