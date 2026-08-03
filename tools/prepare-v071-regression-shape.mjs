import fs from 'node:fs';
import path from 'node:path';

const extractorPath = path.resolve(import.meta.dirname, '..', 'web', 'extractor.js');
let extractor = fs.readFileSync(extractorPath, 'utf8');

if (!extractor.includes('function closestUsageItem') && extractor.includes('function volcAmount')) {
  extractor = extractor.replace('function volcAmount', 'function closestUsageItem');
  fs.writeFileSync(extractorPath, extractor);
}

console.log('Prepared generated Volcengine collector for v0.7.1 repair.');
