import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('../src-tauri/src/update_helper.rs', import.meta.url), 'utf8');
const frontend = fs.readFileSync(new URL('../web/update.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

test('Windows portable updater downloads, verifies, replaces, and restarts', () => {
  assert.match(native, /async fn install_update/);
  assert.match(native, /Get-FileHash/);
  assert.match(native, /SHA-256 mismatch/);
  assert.match(native, /update_helper::prepare_and_spawn/);
  assert.match(native, /app_for_exit\.exit\(0\)/);
  assert.match(native, /refresh_sources,\s*install_update/);
  assert.match(helper, /fs::rename\(target, backup\)/);
  assert.match(helper, /fs::rename\(staged, target\)/);
  assert.match(helper, /launch_replacement/);
  assert.match(frontend, /invoke\('install_update'/);
  assert.match(frontend, /下载、安装并重启/);
  assert.match(html, /id="install-update"/);
});
