const encoder = new TextEncoder();

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function parseNumber(value) {
  if (value == null) return null;
  const match = String(value).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function scaledNumber(value) {
  if (value == null) return null;
  const match = String(value).replaceAll(',', '').match(/(-?\d+(?:\.\d+)?)\s*([KMB万亿]?)/i);
  if (!match) return null;
  const suffix = match[2].toUpperCase();
  const scale = { K: 1e3, M: 1e6, B: 1e9, '万': 1e4, '亿': 1e8 }[suffix] ?? 1;
  return Number(match[1]) * scale;
}

function cleanText(text) {
  return String(text ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function extractReset(text) {
  const match = text.match(/(?:reset(?:s| at)?|next reset|renew(?:s|al)?|重置|恢复|下次重置)[：:\s]*([^\n]{1,80})/i);
  return match ? cleanText(match[1]).split(/\s{2,}/)[0] : null;
}

function quotaKind(context) {
  if (/(weekly|per week|week limit|7[- ]?day|本周|每周|周额度)/i.test(context)) return 'weekly';
  const hours = context.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|小时)/i);
  if (hours) return `${hours[1]}h`;
  if (/(daily|day limit|today|今日|每天|日额度)/i.test(context)) return 'daily';
  if (/(monthly|month limit|本月|每月|月额度)/i.test(context)) return 'monthly';
  return 'unknown';
}

export function extractCodexFromText(input) {
  const text = cleanText(input);
  const lines = text.split(/\n+/).map(cleanText).filter(Boolean);
  const candidates = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!match) continue;
    const value = Number(match[1]);
    if (value < 0 || value > 100) continue;
    const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(' | ');
    if (!/(limit|quota|reset|remaining|left|used|week|hour|额度|限制|重置|剩余|已用|周|小时)/i.test(context)) continue;

    let remaining = null;
    let used = null;
    if (/(remaining|left|available|剩余|可用)/i.test(context)) {
      remaining = value;
      used = 100 - value;
    } else if (/(used|usage|consumed|已用|已使用|消耗)/i.test(context)) {
      used = value;
      remaining = 100 - value;
    }

    candidates.push({
      id: quotaKind(context),
      displayedPercent: value,
      remainingPercent: remaining,
      usedPercent: used,
      resetText: extractReset(context),
      context
    });
  }

  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    const key = `${item.id}|${item.displayedPercent}|${item.resetText ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  unique.sort((a, b) => (a.id === 'weekly' ? -1 : b.id === 'weekly' ? 1 : 0));
  return { source: 'codex', quotas: unique };
}

function findLabeledValue(lines, labels, parser) {
  for (let i = 0; i < lines.length; i += 1) {
    if (!labels.some(label => lines[i].toLowerCase().includes(label.toLowerCase()))) continue;
    const context = lines.slice(i, Math.min(lines.length, i + 4)).join(' ');
    const parsed = parser(context);
    if (parsed != null) return { value: parsed, text: context };
  }
  return null;
}

function moneyValue(text) {
  const match = String(text).replaceAll(',', '').match(/(?:¥|￥|\$|CNY|RMB|USD)\s*(-?\d+(?:\.\d+)?)/i)
    ?? String(text).replaceAll(',', '').match(/(-?\d+(?:\.\d+)?)\s*(?:元|美元)/i);
  return match ? Number(match[1]) : null;
}

export function extractDeepSeekFromText(input) {
  const lines = cleanText(input).split(/\n+/).map(cleanText).filter(Boolean);
  return {
    source: 'deepseek',
    balance: findLabeledValue(lines, ['balance', '余额', '可用余额'], moneyValue),
    todayCost: findLabeledValue(lines, ['today cost', 'today usage', '今日消耗', '今日费用', '今天消耗'], moneyValue),
    monthCost: findLabeledValue(lines, ['this month', 'monthly cost', '本月消耗', '本月费用'], moneyValue),
    todayTokens: findLabeledValue(lines, ['today token', '今日 token', '今日tokens'], scaledNumber),
    monthTokens: findLabeledValue(lines, ['month token', 'monthly token', '本月 token', '本月tokens'], scaledNumber),
    cacheRate: findLabeledValue(lines, ['cache hit', '缓存命中'], parseNumber)
  };
}

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

  const ihdr = concat([
    u32be(width), u32be(height),
    Uint8Array.of(8, 0, 0, 0, 0)
  ]);
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
