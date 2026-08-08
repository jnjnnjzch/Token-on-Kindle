import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/pipeline.yml', import.meta.url);

async function workflowSource() {
  return readFile(workflowUrl, 'utf8');
}

test('Android CI strips Rust debug symbols from the installable APK and guards package size', async () => {
  const source = await workflowSource();
  assert.match(source, /CARGO_PROFILE_DEV_DEBUG:\s*'0'/);
  assert.match(source, /CARGO_PROFILE_DEV_STRIP:\s*symbols/);
  assert.match(source, /CARGO_PROFILE_DEV_OPT_LEVEL:\s*s/);
  assert.match(source, /tauri android build -- --debug --apk --target aarch64/);
  assert.match(source, /max_bytes=\$\(\(50 \* 1024 \* 1024\)\)/);
});

test('Linux release keeps the portable AppImage and also publishes a lightweight deb package', async () => {
  const source = await workflowSource();
  assert.match(source, /--bundles appimage,deb/);
  assert.match(source, /bundle\/deb/);
  assert.match(source, /Token-on-Kindle-\$version-linux-x64\.deb/);
  assert.match(source, /release\/Token-on-Kindle-\*\.deb/);
});
