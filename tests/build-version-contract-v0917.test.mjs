import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Cargo build validates the Codex extractor marker from package version instead of a hard-coded release', () => {
  const build = fs.readFileSync(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
  assert.match(build, /env::var\("CARGO_PKG_VERSION"\)\.expect\("CARGO_PKG_VERSION"\)/);
  assert.match(build, /format!\("codex-adaptive-v\{version\}"\)/);
  assert.match(build, /output\.contains\(&codex_marker\)/);
  assert.doesNotMatch(build, /codex-adaptive-v0\.\d+\.\d+/);
});
