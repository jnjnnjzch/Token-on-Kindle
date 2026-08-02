import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const frontend = fs.readFileSync(new URL('../web/update.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
test('Windows portable updater downloads, verifies, replaces, and restarts', () => {
  assert.match(native, /async fn install_update/); assert.match(native, /Get-FileHash/);
  assert.match(native, /SHA-256 mismatch/); assert.match(native, /Wait-Process/);
  assert.match(native, /Copy-Item/); assert.match(native, /Start-Process/);
  assert.match(native, /app_for_exit\.exit\(0\)/); assert.match(native, /refresh_sources,\s*install_update/);
  assert.match(frontend, /invoke\('install_update'/); assert.match(frontend, /下载、安装并重启/);
  assert.match(html, /id="install-update"/);
});
