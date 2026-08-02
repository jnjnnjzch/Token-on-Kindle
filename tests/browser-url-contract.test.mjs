import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('runtime settings expose distinct browser and image URLs', () => {
  assert.match(rust, /image_url: format!\("http:\/\/{host}:\{\}\/dashboard\.png"/);
  assert.match(rust, /browser_url: format!\("http:\/\/{host}:\{\}\/"/);
});
