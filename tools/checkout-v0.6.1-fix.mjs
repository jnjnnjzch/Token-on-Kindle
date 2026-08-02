import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_HEAD_REF) {
  const branch = process.env.GITHUB_HEAD_REF;
  execFileSync('git', ['fetch', 'origin', branch], { stdio: 'inherit' });
  execFileSync('git', ['checkout', '-B', branch, `origin/${branch}`], { stdio: 'inherit' });
  fs.rmSync('tools/checkout-v0.6.1-fix.mjs');
}
