import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Cargo build validates the Codex reader contract without coupling its revision to app version', () => {
  const build = fs.readFileSync(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
  assert.match(build, /"__TOKEN_ON_KINDLE_CODEX_ADAPTIVE_READER__"/);
  assert.match(build, /"codex-adaptive-v"/);
  assert.doesNotMatch(build, /format!\("codex-adaptive-v\{version\}"\)/);
  assert.doesNotMatch(build, /codex-adaptive-v0\.\d+\.\d+/);
});
