import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const toolUrl = new URL('../tools/compose-volcengine-debug.mjs', import.meta.url);
const probeUrl = new URL('../web/volcengine-debug-probe.js', import.meta.url);

test('Volcengine debug bundle validates without writing', async () => {
  const result = spawnSync(process.execPath, [toolUrl.pathname, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Validated Volcengine debug probe/);
});

test('debug probe is opt-in, bounded, and credential-safe in exported reports', async () => {
  const probe = await readFile(probeUrl, 'utf8');
  assert.match(probe, /localStorage\.getItem\(ENABLE_KEY\) === '1'/);
  assert.match(probe, /MAX_ENTRIES = 60/);
  assert.match(probe, /MAX_REPLAY_TEMPLATES = 20/);
  assert.match(probe, /secretHeader = \/\^\(authorization\|cookie\|proxy-authorization\)\$\/i/);
  assert.doesNotMatch(probe, /document\.cookie/);
  assert.doesNotMatch(probe, /localStorage\.setItem\([^\n]*REPORT_KEY/);
});
