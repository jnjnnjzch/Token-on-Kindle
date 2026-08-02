import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const workflows = fs.readdirSync(new URL('../.github/workflows', import.meta.url)).filter(name => /\.ya?ml$/i.test(name));
const pipeline = fs.readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');
test('repository keeps one reusable workflow and cleans legacy branches and runs', () => {
  assert.deepEqual(workflows, ['pipeline.yml']); assert.match(pipeline, /workflow_call:/);
  assert.match(pipeline, /Repository cleanup/); assert.match(pipeline, /merge-base --is-ancestor/);
  assert.match(pipeline, /Clean stale branches/); assert.match(pipeline, /Windows Portable/);
});
