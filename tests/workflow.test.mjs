import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const workflowDirectory = new URL('../.github/workflows/', import.meta.url);

test('repository keeps one reusable build-to-release workflow', async () => {
  const files = (await readdir(workflowDirectory))
    .filter(name => /\.ya?ml$/i.test(name))
    .sort();
  assert.deepEqual(files, ['pipeline.yml']);

  const source = await readFile(new URL('pipeline.yml', workflowDirectory), 'utf8');
  assert.match(source, /workflow_call:/);
  assert.match(source, /pull_request:/);
  assert.match(source, /tags:\s*\['v\*'\]/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /softprops\/action-gh-release@v2/);
  assert.match(source, /needs\.prepare\.outputs\.publish == 'true'/);
});
