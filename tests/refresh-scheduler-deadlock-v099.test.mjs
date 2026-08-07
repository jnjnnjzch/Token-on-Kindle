import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('scheduled refresh releases the interval mutex before refreshing sources', () => {
  const start = rust.indexOf('fn start_refresh_scheduler(');
  const end = rust.indexOf('fn decode_base64_url(', start);
  const scheduler = rust.slice(start, end);

  assert.ok(start >= 0 && end > start, 'scheduler implementation should be present');
  assert.match(scheduler, /let Ok\(\(guard, timeout\)\) = result/);
  assert.match(scheduler, /let timed_out = timeout\.timed_out\(\);/);
  assert.match(scheduler, /drop\(guard\);/);
  assert.match(scheduler, /if timed_out && !desktop::is_paused\(&app\)/);

  const dropAt = scheduler.indexOf('drop(guard);');
  const refreshAt = scheduler.indexOf('reload_sources(&app)');
  assert.ok(dropAt >= 0 && refreshAt > dropAt, 'refresh mutex must be released before reload_sources reads it');
});

test('one scheduled batch still covers Codex, DeepSeek, and Volcengine', () => {
  const start = rust.indexOf('fn reload_sources(app: &AppHandle)');
  const end = rust.indexOf('#[cfg(any(target_os = "android"', start);
  const refresh = rust.slice(start, end);

  assert.match(refresh, /\("codex", "Codex", true\)/);
  assert.match(refresh, /\("deepseek", "DeepSeek", true\)/);
  assert.match(refresh, /\("volcengine", "火山方舟", true\)/);
});
