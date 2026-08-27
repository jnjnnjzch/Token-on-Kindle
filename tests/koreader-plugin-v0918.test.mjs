import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const plugin = read('koreader/tokenonkindle.koplugin/main.lua');
const helperCommon = read('kindle/extensions/token-on-kindle/bin/common.sh');
const helperUpdate = read('kindle/extensions/token-on-kindle/bin/update.sh');
const helperMirror = read('kindle/extensions/token-on-kindle/bin/mirror-linkss.sh');
const helperScheduler = read('kindle/extensions/token-on-kindle/bin/scheduler.sh');
const helperEnable = read('kindle/extensions/token-on-kindle/bin/enable.sh');
const helperDisable = read('kindle/extensions/token-on-kindle/bin/disable.sh');
const helperMenu = read('kindle/extensions/token-on-kindle/menu.json');

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

test('helper lifecycle is persistent, idempotent, and user controllable', () => {
  assert.match(helperCommon, /background-enabled/);
  assert.match(helperEnable, /token-on-kindle\.conf/);
  assert.match(helperEnable, /mntroot rw/);
  assert.match(helperDisable, /rm -f "\$ENABLED_FILE"/);
  assert.doesNotThrow(() => JSON.parse(helperMenu));
  assert.match(helperMenu, /Refresh dashboard now/);
  assert.match(helperMenu, /Enable sleep refresh/);
  assert.match(helperMenu, /Disable sleep refresh/);
});
