const encoder = new TextEncoder();

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crcTable();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(value) {
  return Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(type, data) {
  const typeBytes = encoder.encode(type);
  return concat([u32be(data.length), typeBytes, data, u32be(crc32(concat([typeBytes, data])))]);
}

function zlibStored(data) {
  const blocks = [Uint8Array.of(0x78, 0x01)];
  let offset = 0;
  while (offset < data.length) {
    const length = Math.min(65535, data.length - offset);
    const final = offset + length >= data.length ? 1 : 0;
    const nlen = (~length) & 0xffff;
    blocks.push(Uint8Array.of(final, length & 255, (length >>> 8) & 255, nlen & 255, (nlen >>> 8) & 255));
    blocks.push(data.subarray(offset, offset + length));
    offset += length;
  }
  blocks.push(u32be(adler32(data)));
  return concat(blocks);
}

export function rgbaToGrayscale(rgba) {
  if (rgba.length % 4 !== 0) throw new Error('RGBA length must be divisible by four');
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
    const alpha = rgba[i + 3] / 255;
    const luminance = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    out[j] = Math.round(luminance * alpha + 255 * (1 - alpha));
  }
  return out;
}

export function encodeGrayscalePng(width, height, pixels) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('invalid dimensions');
  if (pixels.length !== width * height) throw new Error('pixel count does not match dimensions');
  const scanlines = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1);
    scanlines[row] = 0;
    scanlines.set(pixels.subarray(y * width, (y + 1) * width), row + 1);
  }
  const ihdr = concat([u32be(width), u32be(height), Uint8Array.of(8, 0, 0, 0, 0)]);
  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(scanlines)),
    chunk('IEND', new Uint8Array())
  ]);
}

export function verifyKindlePng(bytes, expectedWidth = 600, expectedHeight = 800) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) return { ok: false, error: 'not a PNG' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24];
  const colourType = bytes[25];
  const ok = width === expectedWidth && height === expectedHeight && bitDepth === 8 && colourType === 0;
  return { ok, width, height, bitDepth, colourType, error: ok ? null : 'PNG is not 600x800 8-bit grayscale' };
}
