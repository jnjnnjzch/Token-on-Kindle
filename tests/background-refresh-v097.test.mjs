import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

test('cold-start refresh auto-creates all missing source windows', () => {
  const refreshStart = rust.indexOf('fn reload_sources(app: &AppHandle)');
  const refreshEnd = rust.indexOf('#[cfg(any(target_os = "android"', refreshStart);
  const refresh = rust.slice(refreshStart, refreshEnd);
  assert.match(refresh, /ensure_source_window\(app, source\)/);
  assert.match(refresh, /if created/);
  assert.match(refresh, /refreshed\.push\(format!\("\{source_name\}（已启动）"\)\)/);
  assert.doesNotMatch(refresh, /后台窗口不存在/);
});

test('startup warm-up failures cannot terminate the dashboard', () => {
  const setupStart = rust.indexOf('.setup(move |app|');
  const setupEnd = rust.indexOf('.on_window_event', setupStart);
  const setup = rust.slice(setupStart, setupEnd);
  assert.match(setup, /if let Err\(error\) = create_source_window/);
  assert.doesNotMatch(setup, /create_source_window\([^)]*\)\?/);
});

test('refresh command has a hard UI timeout and API-worker copy', () => {
  assert.match(app, /REFRESH_COMMAND_TIMEOUT_MS = 15_000/);
  assert.match(app, /刷新命令超过 15 秒未返回/);
  assert.match(app, /登录后会自动同步/);
  assert.match(app, /接口 Worker 会自动建立会话并同步/);
  assert.match(app, /登录后会自动建立接口会话并切换到轻量后台 Worker/);
  assert.match(app, /已触发刷新，等待接口返回/);
  assert.doesNotMatch(app, /识别到 AFP 卡片后会自动同步/);
});
