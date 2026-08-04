import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
const root = path.resolve(import.meta.dirname, '..');
const names = ['00', '01', '02', '03a', '03b', '04a', '04b'];
const packed = names.map(name => fs.readFileSync(path.join(root, 'tools', `v080-packed.part${name}`), 'utf8').trim()).join('');
const source = gunzipSync(Buffer.from(packed, 'base64')).toString('utf8');
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
