import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync('src-tauri/src/desktop.rs', 'utf8');
const html = fs.readFileSync('web/index.html', 'utf8');
const js = fs.readFileSync('web/desktop.js', 'utf8');
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');

test('desktop integrations use the real app icon and native tray events', () => {
  assert.match(rust, /include_image!\("icons\/icon\.png"\)/);
  assert.match(rust, /TrayIconEvent::Click/);
  assert.match(rust, /TrayIconEvent::DoubleClick/);
  assert.match(rust, /show_menu_on_left_click\(false\)/);
});

test('tray provides background, browser, update, and autostart controls', () => {
  for (const id of ['pause', 'open_browser', 'copy_browser', 'autostart', 'update']) {
    assert.match(rust, new RegExp('"' + id + '"'));
  }
  assert.match(cargo, /tauri-plugin-autostart/);
  assert.match(cargo, /tauri-plugin-clipboard-manager/);
  assert.match(cargo, /tauri-plugin-opener/);
});

test('desktop UI mirrors state and tray update actions', () => {
  assert.match(html, /id="desktop-integration"/);
  assert.match(html, /id="toggle-autostart"/);
  assert.match(js, /set_tray_source_status/);
  assert.match(js, /set_tray_update_status/);
  assert.match(js, /desktop-update-action/);
});

test('Linux has a safe close fallback and macOS uses menu bar mode', () => {
  assert.match(rust, /tray_available/);
  assert.match(rust, /set_dock_visibility\(false\)/);
  assert.match(rust, /window\.label\(\) != "main"/);
});
