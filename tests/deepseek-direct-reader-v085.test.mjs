import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('DeepSeek uses the Platform page APIs first and keeps page fallback isolated', async () => {
  const [reader, built] = await Promise.all([
    readFile(new URL('../web/deepseek-direct-reader.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/extractor.js', import.meta.url), 'utf8')
  ]);
  assert.match(reader, /\/api\/v0\/users\/get_user_summary/);
  assert.match(reader, /\/api\/v0\/usage\/amount/);
  assert.match(reader, /\/api\/v0\/usage\/cost/);
  assert.match(reader, /__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_PLATFORM__/);
  assert.match(reader, /primarySource: 'platform-internal-api'/);
  assert.match(reader, /legacySync/);
  assert.doesNotMatch(reader, /MutationObserver/);
  assert.match(built, /TOKEN-ON-KINDLE DIRECT READERS BUILD/);
  assert.match(built, /platform-internal-api/);
  assert.match(built, /__TOKEN_ON_KINDLE_DEEPSEEK_DIRECT_READER__/);
});
