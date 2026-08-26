import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const reader = fs.readFileSync(new URL('../web/codex-direct-reader.js', import.meta.url), 'utf8');
const generated = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-kindle-eink-v0914.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');

test('v0.9.17 release contracts are present in the generated build inputs', () => {
  assert.equal(pkg.version, '0.9.17');
  assert.match(reader, /codex-adaptive-v0\.9\.17/);
  assert.match(generated, /codex-adaptive-v0\.9\.17/);
  assert.match(compose, /sources\.length === 2 && sources\[0\] === 'codex' && sources\[1\] === 'deepseek'/);
  assert.match(compose, /drawLegacyQuotaColumn\(ctx, hourly, 28, 272, '5 小时额度'\)/);
  assert.match(compose, /drawLegacyQuotaColumn\(ctx, weekly, 300, 272, '周额度'\)/);
});

test('release publication remains gated behind successful platform builds', () => {
  assert.match(workflow, /needs: \[prepare, windows, desktop, android\]/);
  assert.match(workflow, /name: Windows portable EXE/);
  assert.match(workflow, /Create or update GitHub Release/);
});
