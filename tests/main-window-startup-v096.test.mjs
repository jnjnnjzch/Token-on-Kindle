import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const setup = rust.slice(rust.indexOf('.setup(move |app|'), rust.indexOf('.on_window_event', rust.indexOf('.setup(move |app|')));

test('main window starts first and provider warm-up is non-fatal', () => {
  assert.match(rust, /fn ensure_source_window\(/);
  assert.match(setup, /for source in \["codex", "deepseek", "volcengine"\]/);
  assert.match(setup, /if let Err\(error\) = create_source_window\(app\.handle\(\), source\)/);
  assert.doesNotMatch(setup, /create_source_window\([^)]*\)\?/);
  assert.doesNotMatch(setup, /initialization_script\(EXTRACTOR_SCRIPT\)/);
  assert.equal((rust.match(/\.initialization_script\(EXTRACTOR_SCRIPT\)/g) || []).length, 1);
});

test('manual and scheduled refresh recreate missing provider windows and reload all hidden workers', () => {
  const refresh = rust.slice(rust.indexOf('fn reload_sources(app: &AppHandle)'), rust.indexOf('#[cfg(any(target_os = "android"', rust.indexOf('fn reload_sources(app: &AppHandle)')));
  assert.match(refresh, /ensure_source_window\(app, source\)/);
  assert.match(refresh, /\("codex", "Codex", true\)/);
  assert.match(refresh, /\("deepseek", "DeepSeek", true\)/);
  assert.match(refresh, /\("volcengine", "火山方舟", true\)/);
  assert.doesNotMatch(refresh, /\("volcengine", "火山方舟", false\)/);
  assert.match(refresh, /if created/);
  assert.match(refresh, /已启动/);
});

test('dashboard PNG uses the v0.6.2 direct encoder path', () => {
  assert.doesNotMatch(app, /new Worker/);
  assert.doesNotMatch(app, /PNG_WORKER_TIMEOUT_MS/);
  assert.match(app, /encodeGrayscalePng\(profile\.width, profile\.height, rgbaToGrayscale\(rgba\)\)/);
});
