import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('extractor composition is repeatable, CRLF-safe, and shared by Cargo', async () => {
  const [composer, buildScript, packageJson, built] = await Promise.all([
    readFile(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/build.rs', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../web/extractor.js', import.meta.url), 'utf8')
  ]);
  assert.match(composer, /replaceAll\('\\r\\n', '\\n'\)/);
  assert.match(buildScript, /Command::new\("node"\)/);
  assert.match(buildScript, /compose-extractor\.mjs/);
  assert.match(packageJson, /compose-extractor\.mjs/);
  assert.match(built, /TOKEN-ON-KINDLE DIRECT API WORKERS BUILD/);
  assert.match(built, /platform-internal-api/);
  assert.match(built, /GetAgentPlanSeatAFPUsage/);
  assert.match(built, /GetAgentPlanSeatUsageDetails/);
  assert.match(built, /v0\.6\.2-reload-worker/);
  assert.doesNotMatch(built, /getEchartsInstance|__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__/);
  assert.doesNotMatch(built, /new MutationObserver/);
  assert.doesNotMatch(built, /__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__/);
});
