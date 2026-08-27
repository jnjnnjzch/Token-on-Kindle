import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const helperRoot = 'koreader/tokenonkindle.koplugin/kindle-helper';

const plugin = read('koreader/tokenonkindle.koplugin/main.lua');
const helperCommon = read(`${helperRoot}/bin/common.sh`);
const helperUpdate = read(`${helperRoot}/bin/update.sh`);
const helperMirror = read(`${helperRoot}/bin/mirror-linkss.sh`);
const helperScheduler = read(`${helperRoot}/bin/scheduler.sh`);
const helperStart = read(`${helperRoot}/bin/start.sh`);
const helperEnable = read(`${helperRoot}/bin/enable.sh`);
const helperDisable = read(`${helperRoot}/bin/disable.sh`);
const helperMenu = read(`${helperRoot}/menu.json`);

test('KOReader foreground plugin cannot shadow gettext with HTTP response headers', () => {
  assert.match(plugin, /local request_ok, ok, code, response_headers, status = pcall\(http\.request/);
  assert.doesNotMatch(plugin, /local\s+[^\n]*\b_\b[^\n]*=\s*http\.request/);
  assert.doesNotMatch(plugin, /local\s+[^\n]*\b_\b[^\n]*=\s*pcall\(http\.request/);
});

test('KOReader plugin uses LAN connectivity and closes URL dialog before refresh', () => {
  assert.match(plugin, /NetworkMgr:runWhenConnected/);
  assert.doesNotMatch(plugin, /NetworkMgr:runWhenOnline/);
  assert.match(plugin, /UIManager:close\(dialog\)[\s\S]*UIManager:nextTick\(function\(\)[\s\S]*self:syncNow\(true, true\)/);
});

test('KOReader plugin uses the native single-file wallpaper contract', () => {
  assert.match(plugin, /Device:supportsScreensaver\(\)/);
  assert.match(plugin, /screensaver_type", "document_cover"/);
  assert.match(plugin, /screensaver_document_cover", OUTPUT_FILE/);
  assert.match(plugin, /sorting_hint = "more_tools"/);
  assert.match(plugin, /is_doc_only = false/);
});

test('KOReader Lua layer does not pretend it can schedule work through suspend', () => {
  assert.doesNotMatch(plugin, /UIManager:scheduleIn/);
  assert.doesNotMatch(plugin, /scheduleNextSync/);
  assert.match(plugin, /The KOReader event loop stops while the Kindle is suspended/);
});

test('KOReader plugin bundles and self-installs its Kindle helper', () => {
  assert.match(plugin, /self\.path \.\. "\/kindle-helper"/);
  assert.match(plugin, /FFIUtil\.copyFile\(source, target\)/);
  assert.match(plugin, /HELPER_BUNDLE_VERSION/);
  assert.match(plugin, /Install \/ repair sleep helper/);
  assert.match(plugin, /\/mnt\/us\/extensions\/token-on-kindle/);
});

test('sleep helper uses powerd RTC events instead of a busy polling loop', () => {
  assert.match(helperScheduler, /lipc-wait-event/);
  assert.match(helperScheduler, /readyToSuspend/);
  assert.match(helperScheduler, /wakeupFromSuspend/);
  assert.match(helperScheduler, /resuming/);
  assert.match(helperScheduler, /com\.lab126\.powerd rtcWakeup/);
  assert.match(helperScheduler, /interval_seconds/);
});

test('sleep helper wakes Wi-Fi but never forces airplane-mode-style shutdown', () => {
  assert.match(helperUpdate, /com\.lab126\.cmd wirelessEnable 1/);
  assert.match(helperUpdate, /com\.lab126\.wifid enable 1/);
  assert.match(helperUpdate, /deferSuspend 60/);
  assert.doesNotMatch(helperUpdate, /wirelessEnable 0/);
  assert.doesNotMatch(helperUpdate, /com\.lab126\.wifid enable 0/);
  assert.doesNotMatch(helperUpdate, /\bping\b/);
});

test('linkss mirror follows linkss device sizing and eips PNG8 requirements', () => {
  assert.match(helperMirror, /libkh5/);
  assert.match(helperMirror, /MY_SCREEN_SIZE/);
  assert.match(helperMirror, /bg_ss/);
  assert.match(helperMirror, /bg_medium_ss/);
  assert.match(helperMirror, /bg_xsmall_ss/);
  assert.match(helperMirror, /-colorspace Gray/);
  assert.match(helperMirror, /png:color-type=0/);
  assert.match(helperMirror, /png:bit-depth=8/);
  assert.match(helperUpdate, /eips -f -g/);
});

test('helper stays in user storage and remains idempotent/user controllable', () => {
  assert.match(helperCommon, /background-enabled/);
  assert.match(helperStart, /pid_is_alive/);
  assert.match(helperEnable, /touch "\$ENABLED_FILE"/);
  assert.match(helperDisable, /rm -f "\$ENABLED_FILE"/);
  assert.doesNotMatch(helperEnable, /mntroot|\/etc\/upstart/);
  assert.doesNotThrow(() => JSON.parse(helperMenu));
  assert.match(helperMenu, /Refresh dashboard now/);
  assert.match(helperMenu, /Enable sleep refresh/);
  assert.match(helperMenu, /Disable sleep refresh/);
});

test('all bundled Kindle helper scripts pass POSIX shell syntax check', () => {
  const scripts = [
    'common.sh', 'mirror-linkss.sh', 'update.sh', 'scheduler.sh',
    'start.sh', 'enable.sh', 'disable.sh',
  ];
  for (const script of scripts) {
    const path = new URL(`../${helperRoot}/bin/${script}`, import.meta.url);
    const result = spawnSync('sh', ['-n', path.pathname], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`);
  }
});
