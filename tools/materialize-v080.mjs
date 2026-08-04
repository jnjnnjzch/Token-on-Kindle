import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
const root = path.resolve(import.meta.dirname, '..');
const packed = [0,1,2,3,4].map(i => fs.readFileSync(path.join(root, 'tools', `v080-packed.part${String(i).padStart(2,'0')}`), 'utf8').trim()).join('');
const source = gunzipSync(Buffer.from(packed, 'base64')).toString('utf8');
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
