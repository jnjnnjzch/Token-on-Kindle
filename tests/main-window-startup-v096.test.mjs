import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const setup = rust.slice(rust.indexOf('.setup(move |app|'), rust.indexOf('.on_window_event', rust.indexOf('.setup(move |app|')));

test('main window startup does not construct provider WebViews', () => {
  assert.match(rust, /fn create_source_window\(app: &AppHandle/);
  assert.match(rust, /create_source_window\(app, source\)/);
  assert.doesNotMatch(setup, /create_source_window/);
  assert.doesNotMatch(setup, /initialization_script\(EXTRACTOR_SCRIPT\)/);
  assert.equal((rust.match(/\.initialization_script\(EXTRACTOR_SCRIPT\)/g) || []).length, 1);
});

test('provider creation failure is returned without terminating main setup', () => {
  assert.match(rust, /无法创建 \{label\} 数据源窗口/);
  assert.doesNotMatch(setup, /create_source_window\([^)]*\)\?/);
});

test('dashboard PNG uses the v0.6.2 direct encoder path', () => {
  assert.doesNotMatch(app, /new Worker/);
  assert.doesNotMatch(app, /PNG_WORKER_TIMEOUT_MS/);
  assert.match(app, /encodeGrayscalePng\(profile\.width, profile\.height, rgbaToGrayscale\(rgba\)\)/);
});
