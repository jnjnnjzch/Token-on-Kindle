import http from 'node:http';
import fs from 'node:fs';
import { encodeGrayscalePng, verifyKindlePng } from '../shared/core.mjs';

const pixels = new Uint8Array(600 * 800).fill(255);
for (let y = 0; y < 800; y += 1) {
  if (y % 80 < 4) pixels.fill(0, y * 600, (y + 1) * 600);
}
const png = encodeGrayscalePng(600, 800, pixels);
const check = verifyKindlePng(png);
if (!check.ok) throw new Error(check.error);
fs.writeFileSync('/tmp/token-on-kindle-smoke.png', png);

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/dashboard.png')) {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': png.length,
      'Cache-Control': 'no-store'
    });
    res.end(png);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, check }));
  }
});
server.listen(18765, '127.0.0.1', () => {
  console.log('SMOKE_READY http://127.0.0.1:18765/dashboard.png');
});
