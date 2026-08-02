import { execFileSync } from 'node:child_process';

if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_HEAD_REF) {
  const branch = process.env.GITHUB_HEAD_REF;
  execFileSync('git', ['fetch', 'origin', branch], { stdio: 'inherit' });
  execFileSync('git', ['checkout', '-B', branch, `origin/${branch}`], { stdio: 'inherit' });
}
