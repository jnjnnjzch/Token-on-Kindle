import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [
  'src-tauri/src/lib.rs',
  'src-tauri/Cargo.toml',
  'web/extractor.js',
  'web/styles.css',
  'README.md'
];

for (const relative of files) {
  const target = path.join(root, relative);
  const original = fs.readFileSync(target, 'utf8');
  const normalized = original.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (normalized !== original) fs.writeFileSync(target, normalized);
}

console.log('Normalized v0.7.0 generator inputs.');
