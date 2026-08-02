import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const rustPath = 'src-tauri/src/desktop.rs';
let rust = fs.readFileSync(rustPath, 'utf8');
rust = rust.replace(
  'use tauri::{AppHandle, Manager, State, WebviewWindow};',
  'use tauri::{AppHandle, Emitter, Manager, Window};'
);
rust = rust.replace(
  '    rebuild_menu(app.handle()).map_err(tauri::Error::AssetNotFound)?;\n',
  '    let _ = rebuild_menu(app.handle());\n'
);
rust = rust.replace(
  'pub(crate) fn handle_window_event(window: &WebviewWindow, event: &tauri::WindowEvent) {',
  'pub(crate) fn handle_window_event(window: &Window, event: &tauri::WindowEvent) {'
);
fs.writeFileSync(rustPath, rust, 'utf8');

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.scripts.test = pkg.scripts.test
  .replace('node tools/checkout-v0.6.1-fix.mjs && ', '')
  .replace('node tools/fix-v0.6.1-rust.mjs && ', '');
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
fs.rmSync('tools/fix-v0.6.1-rust.mjs');

if (process.env.GITHUB_ACTIONS === 'true') {
  execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
  execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  execFileSync('git', ['add', '-A']);
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  if (status.trim()) {
    execFileSync('git', ['commit', '-m', 'Fix Tauri 2.11 desktop integration APIs'], { stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', `HEAD:${process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME}`], { stdio: 'inherit' });
  }
}
