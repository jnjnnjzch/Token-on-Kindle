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
  assert.match(packageJson, /compose-extractor\.mjs && node tools\/compose-extractor\.mjs/);
  assert.match(built, /TOKEN-ON-KINDLE DIRECT READERS BUILD/);
  assert.match(built, /platform-internal-api/);
  assert.match(built, /getEchartsInstance/);
  assert.doesNotMatch(built, /new MutationObserver/);
  assert.doesNotMatch(built, /\n\s*installVolcengineNetworkCapture\(\);/);
});
