import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mainUrl = new URL('../koreader/tokenonkindle.koplugin/main.lua', import.meta.url);
const helperUrl = new URL('../koreader/tokenonkindle.koplugin/bin/helper.sh', import.meta.url);
const daemonUrl = new URL('../koreader/tokenonkindle.koplugin/bin/daemon.sh', import.meta.url);
const updateUrl = new URL('../koreader/tokenonkindle.koplugin/bin/update.sh', import.meta.url);
const readmeUrl = new URL('../koreader/README.md', import.meta.url);
const rendererUrl = new URL('../web/kindle-renderer.js', import.meta.url);

const main = fs.readFileSync(mainUrl, 'utf8');
const helper = fs.readFileSync(helperUrl, 'utf8');
const daemon = fs.readFileSync(daemonUrl, 'utf8');
const update = fs.readFileSync(updateUrl, 'utf8');
const readme = fs.readFileSync(readmeUrl, 'utf8');
const renderer = fs.readFileSync(rendererUrl, 'utf8');

test('KOReader plugin uses a normal More tools entry and no longer owns network transport in Lua', () => {
  assert.match(main, /is_doc_only = false/);
  assert.match(main, /sorting_hint = "more_tools"/);
  assert.match(main, /save_callback = function\(value, closing\)/);
  assert.doesNotMatch(main, /socket\.http/);
  assert.doesNotMatch(main, /runWhenOnline/);
  assert.doesNotMatch(main, /local ok, code, _, status/);
});

test('KOReader sleep screen is a stable fixed document cover, independent of linkss', () => {
  assert.match(main, /OUTPUT_FILE = DATA_DIR \.\. "\/dashboard\.png"/);
  assert.match(main, /saveSetting\("screensaver_type", "document_cover"\)/);
  assert.match(main, /saveSetting\("screensaver_document_cover", OUTPUT_FILE\)/);
  assert.match(main, /Device:supportsScreensaver\(\)/);
  assert.doesNotMatch(main, /screensaver_type", "random_image"/);
});

test('background helper is independent of Amazon lab126_gui and uses powerd RTC wakeups', () => {
  assert.match(daemon, /readyToSuspend,wakeupFromSuspend,resuming/);
  assert.match(daemon, /com\.lab126\.powerd rtcWakeup/);
  assert.doesNotMatch(helper + daemon, /start on started lab126_gui/);
  assert.doesNotMatch(helper + daemon, /\/etc\/upstart/);
  assert.match(helper, /exec \/bin\/sh "\$SCRIPT_DIR\/daemon\.sh"/);
});

test('readyToSuspend paints the cached dashboard before suspend without racing powerd textual state', () => {
  const paintStart = daemon.indexOf('paint_cached_screen()');
  const mainStart = daemon.indexOf('if ! load_config;', paintStart);
  assert.ok(paintStart >= 0 && mainStart > paintStart);
  const paintFunction = daemon.slice(paintStart, mainStart);
  assert.match(paintFunction, /eips -f -g "\$OUTPUT_FILE"/);
  assert.doesNotMatch(paintFunction, /grep -q "Screen Saver"/);
  assert.match(daemon, /readyToSuspend\*\)[\s\S]*paint_cached_screen/);
});

test('sleep updater restores Wi-Fi, uses the LAN image directly, mirrors linkss, and only repaints periodic updates in Screen Saver state', () => {
  assert.match(update, /com\.lab126\.cmd wirelessEnable 1/);
  assert.match(update, /com\.lab126\.wifid enable 1/);
  assert.match(update, /curl -fL -m 8[\s\S]*"\$IMAGE_URL"/);
  assert.doesNotMatch(update, /TEST_DOMAIN|ping -c/);
  assert.match(update, /mv -f "\$TMP_FILE" "\$OUTPUT_FILE"/);
  assert.match(update, /linkss mirror updated/);
  assert.match(update, /grep -q "Screen Saver"/);
  assert.match(update, /eips -f -g "\$OUTPUT_FILE"/);
  assert.match(update, /WIFI_WAS_OFF/);
});

test('manual and RTC refreshes are serialized and daemon startup does not race the first UI sync', () => {
  assert.match(update, /LOCK_DIR="\/tmp\/token-on-kindle-update\.lock"/);
  assert.match(update, /if mkdir "\$LOCK_DIR"/);
  assert.match(update, /kill -0 "\$OWNER"/);
  assert.match(daemon, /NEXT_UPDATE=\$\(\( NOW \+ INTERVAL_SECONDS \)\)/);
  assert.doesNotMatch(daemon, /NEXT_UPDATE=0/);
});

test('KT2 output remains native 600x800 and documentation explains no-framework ownership', () => {
  assert.match(renderer, /width: 600/);
  assert.match(renderer, /height: 800/);
  assert.match(readme, /Start KOReader \(no framework\)/);
  assert.match(readme, /`linkss` is a mirror, not the active no-framework sleep-screen mechanism/i);
  assert.match(readme, /rtcWakeup/);
});

test('helper shell scripts are syntactically valid on POSIX CI', { skip: process.platform === 'win32' }, () => {
  for (const url of [helperUrl, daemonUrl, updateUrl]) {
    execFileSync('/bin/sh', ['-n', fileURLToPath(url)], { stdio: 'pipe' });
  }
});
