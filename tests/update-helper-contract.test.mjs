import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lib = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
const helper = fs.readFileSync('src-tauri/src/update_helper.rs', 'utf8');
const main = fs.readFileSync('src-tauri/src/main.rs', 'utf8');
const desktopRust = fs.readFileSync('src-tauri/src/desktop.rs', 'utf8');
const desktopJs = fs.readFileSync('web/desktop.js', 'utf8');
const updateJs = fs.readFileSync('web/update.js', 'utf8');

test('Windows updater uses an independent executable helper instead of a silent post-exit PowerShell script', () => {
  assert.match(main, /run_update_helper_from_args/);
  assert.match(lib, /update_helper::prepare_and_spawn/);
  assert.doesNotMatch(lib, /replace-and-restart\.ps1/);
  assert.doesNotMatch(lib, /Wait-Process/);
  assert.match(helper, /Token-on-Kindle-update-helper\.exe/);
  assert.match(helper, /CREATE_NEW_PROCESS_GROUP/);
  assert.match(helper, /CREATE_BREAKAWAY_FROM_JOB/);
});

test('updater preflights the target directory and performs recoverable replacement', () => {
  assert.match(helper, /无法在程序目录预写入新版本/);
  assert.match(helper, /fs::rename\(target, backup\)/);
  assert.match(helper, /fs::rename\(staged, target\)/);
  assert.match(helper, /已恢复旧版本/);
  assert.match(helper, /update\.log/);
});

test('tray readiness is pushed after native tray creation and re-read by the UI', () => {
  assert.match(desktopRust, /tray_available\.store\(true/);
  assert.match(desktopRust, /desktop-state-changed/);
  assert.match(desktopJs, /setTimeout\(loadDesktopState, 600\)/);
  assert.match(desktopJs, /setTimeout\(loadDesktopState, 1800\)/);
});

test('the UI confirms a completed update only after the restarted binary reports the requested version', () => {
  assert.match(updateJs, /pending-update/);
  assert.match(updateJs, /compareVersions\(APP_VERSION, pendingUpdate\) >= 0/);
  assert.match(updateJs, /更新成功/);
});
