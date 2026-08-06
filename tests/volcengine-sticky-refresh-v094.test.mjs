import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('Volcengine opens on the Agent Plan Enterprise route', () => {
  assert.match(rust, /const VOLCENGINE_URL: &str\s*=\s*"https:\/\/console\.volcengine\.com\/ark\/region:cn-beijing\/subscription\/agent-plan-enterprise";/);
});

test('desktop refresh preserves the selected Volcengine SPA view', () => {
  const refreshBlock = rust.match(/fn reload_sources\(app: &AppHandle\)[\s\S]*?#\[cfg\(any/)?.[0] || '';
  assert.match(refreshBlock, /\("codex", "Codex", true\)/);
  assert.match(refreshBlock, /\("deepseek", "DeepSeek", true\)/);
  assert.match(refreshBlock, /\("volcengine", "火山方舟", false\)/);
  assert.match(refreshBlock, /match background_refresh_window\(/);
  assert.match(refreshBlock, /Ok\(RefreshSummary \{ refreshed, failed \}\)/);
});

test('the extractor still exposes an in-page sync hook', () => {
  assert.match(extractor, /window\.__TOKEN_ON_KINDLE_SYNC__\s*=\s*/);
});
