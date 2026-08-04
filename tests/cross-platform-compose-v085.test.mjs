import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('extractor composition is repeatable and normalizes Windows CRLF input', async () => {
  const [composer, buildScript, packageJson] = await Promise.all([
    readFile(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/build.rs', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  assert.match(composer, /replaceAll\('\\r\\n', '\\n'\)/);
  assert.match(buildScript, /\.replace\("\\r\\n", "\\n"\)/);
  assert.match(packageJson, /compose-extractor\.mjs && node tools\/compose-extractor\.mjs/);
  assert.match(composer, /else if \(canonical\.includes\('new MutationObserver'\)\)/);
  assert.match(buildScript, /!canonical\.contains\("new MutationObserver"\)/);
});
