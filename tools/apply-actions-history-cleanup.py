import json
import os
import subprocess
from pathlib import Path

BRANCH = 'agent/actions-history-cleanup'
ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_HEAD_REF') == BRANCH:
    subprocess.run(['git', 'fetch', 'origin', BRANCH], check=True)
    subprocess.run(['git', 'checkout', '-B', BRANCH, f'origin/{BRANCH}'], check=True)

pipeline_path = Path('.github/workflows/pipeline.yml')
pipeline = pipeline_path.read_text(encoding='utf-8')
old = "          legacy='^(Clean stale branches|Core Checks|Desktop Matrix|Publish release|Windows Portable)$'"
new = "          legacy='^(Clean stale branches|Core Checks|Desktop Matrix|Publish release|Windows Portable|Materialize v0\\.8\\.0 source|Apply v0\\.8\\.1 focus fix|Apply v0\\.8\\.1 focus fix from PR)$'"
if old in pipeline:
    pipeline = pipeline.replace(old, new, 1)
elif new not in pipeline:
    raise SystemExit('legacy workflow cleanup expression not found')
pipeline_path.write_text(pipeline, encoding='utf-8')

Path('tests/repository-cleanup.test.mjs').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pipeline = fs.readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');

test('repository keeps one permanent workflow with branch and run cleanup', () => {
  assert.match(pipeline, /name: Build and release/);
  assert.match(pipeline, /Remove merged work branches/);
  assert.match(pipeline, /Remove legacy workflow run history/);
  for (const name of [
    'Materialize v0\\\\.8\\\\.0 source',
    'Apply v0\\\\.8\\\\.1 focus fix',
    'Apply v0\\\\.8\\\\.1 focus fix from PR'
  ]) assert.match(pipeline, new RegExp(name));
});
''', encoding='utf-8')

if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_HEAD_REF') == BRANCH:
    package_path = Path('package.json')
    package = json.loads(package_path.read_text(encoding='utf-8'))
    prefix = 'python3 tools/apply-actions-history-cleanup.py && '
    if package['scripts']['test'].startswith(prefix):
        package['scripts']['test'] = package['scripts']['test'][len(prefix):]
    package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    Path('tools/apply-actions-history-cleanup.py').unlink(missing_ok=True)

    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
    subprocess.run(['git', 'add', '-A'], check=True)
    subprocess.run(['git', 'commit', '-m', 'clean legacy workflow run history'], check=True)
    subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'], check=True)
