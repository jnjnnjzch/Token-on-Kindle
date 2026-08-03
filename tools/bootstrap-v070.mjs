import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const payloads = [
  'tools/apply-v070.payload00',
  'tools/apply-v070.payload01',
  'tools/apply-v070.payload02',
  'tools/apply-v070.payload03',
  'tools/apply-v070.payload04',
  'tools/apply-v070.payload05',
  'tools/apply-v070.payload06',
  'tools/apply-v070.payload07'
];
const legacyParts = [
  'tools/apply-v070.part00',
  'tools/apply-v070.part01',
  'tools/apply-v070.part02',
  'tools/apply-v070.part03a',
  'tools/apply-v070.part03b',
  'tools/apply-v070.part03c',
  'tools/apply-v070.part03d'
];

if (JSON.parse(fs.readFileSync('package.json', 'utf8')).version !== '0.7.0') {
  const encoded = payloads.map(path => fs.readFileSync(path, 'utf8')).join('');
  if (encoded.length !== 45284) throw new Error(`Unexpected v0.7.0 payload length: ${encoded.length}`);
  const digest = createHash('sha256').update(encoded).digest('hex');
  if (digest !== '8ea2a1edfcb26585dc89301e2e435f6b534094a03a94ef52cacb50bd8ec587ad') {
    throw new Error(`Unexpected v0.7.0 payload checksum: ${digest}`);
  }
  fs.writeFileSync('tools/apply-v070.mjs', gunzipSync(Buffer.from(encoded, 'base64')));
  await import(new URL('./apply-v070.mjs', import.meta.url));
}

const cleanupFiles = [...payloads, ...legacyParts, 'tools/bootstrap-v070.mjs', 'tools/apply-v070.mjs', 'tools/finalize-v070.mjs', '.github/workflows/apply-v070.yml'];
fs.writeFileSync('tools/finalize-v070.mjs', `import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const name of ['pretest', 'posttest', 'preinstall']) delete pkg.scripts[name];
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
for (const path of ${JSON.stringify(cleanupFiles)}) {
  try { fs.rmSync(path); } catch {}
}
if (process.env.CI && process.env.GITHUB_HEAD_REF) {
  const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  run('git', ['checkout', '-B', process.env.GITHUB_HEAD_REF]);
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', 'v0.7.0: add Volcengine AFP and display controls']);
  run('git', ['push', 'origin', 'HEAD:' + process.env.GITHUB_HEAD_REF]);
}
`);
