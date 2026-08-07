import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const rendererPath = path.join(root, 'web', 'kindle-renderer.js');
const marker = '/* TOKEN-ON-KINDLE VOLCENGINE TEXT MODEL LIST */';
let source = fs.readFileSync(rendererPath, 'utf8').replaceAll('\r\n', '\n');

function replaceBlock(input, startMarker, endMarker, replacement, label) {
  const start = input.indexOf(startMarker);
  if (start < 0) throw new Error(`${label} start marker changed`);
  const end = input.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label} end marker changed`);
  return `${input.slice(0, start)}${replacement.trimEnd()}\n\n${input.slice(end)}`;
}

const kindleLayout = `export const KINDLE_LAYOUT = Object.freeze({
  width: 600,
  height: 800,
  contentTop: 70,
  contentBottom: 706,
  unlockTop: 716,
  unlockHeight: 84
});`;

const preferredLayout = `function preferredHeights(sources) {
  if (sources.length === 1) return [KINDLE_LAYOUT.contentBottom - KINDLE_LAYOUT.contentTop];
  if (sources.length === 2 && sources.includes('deepseek')) {
    return sources.map(source => source === 'deepseek' ? 382 : 244);
  }
  if (sources.length === 2) return [313, 313];
  return sources.map(source => ({ codex: 146, deepseek: 332, volcengine: 150 })[source]);
}`;

const codexRenderer = `function drawCodexQuotaRow(ctx, quota, x, y, width, height, label, primary = false) {
  const remaining = quotaRemaining(quota);
  const used = numericValue(quota?.usedPercent) ?? (remaining == null ? null : 100 - remaining);
  const labelSize = primary ? 12 : 10.5;
  const valueSize = primary ? 28 : 17;
  drawText(ctx, label, x + 12, y + 3, labelSize, 800, 'left', PALETTE.dark);
  drawText(ctx, quota ? formatPercent(remaining) : '—', x + width - 12, y + (primary ? -2 : 1), valueSize, 850, 'right');
  if (!quota) return;

  const barY = y + (primary ? 29 : 20);
  drawBar(ctx, x + 12, barY, width - 24, primary ? 9 : 5, remaining == null ? 0 : remaining / 100);
  const detailY = barY + (primary ? 13 : 8);
  drawText(ctx, used == null ? '已用 —' : '已用 ' + formatPercent(used), x + 12, detailY, primary ? 9 : 7.5, 650, 'left', PALETTE.dark);
  if (quota?.resetText) {
    drawText(ctx, shorten(quota.resetText, primary ? 34 : 28), x + width - 12, detailY, primary ? 9 : 7.5, 600, 'right', PALETTE.dark);
  }
}

function drawCodex(ctx, codex, box) {
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.white, PALETTE.ink, 2);
  drawCardTitle(ctx, 'CODEX', box);
  const { weekly, hourly } = selectCodexQuotas(codex);
  const bodyY = box.y + 40;
  const hourlyHeight = 36;
  const weeklyY = bodyY + hourlyHeight + 2;
  drawCodexQuotaRow(ctx, hourly, box.x, bodyY, box.width, hourlyHeight, '5 小时额度', false);
  drawLine(ctx, box.x + 12, weeklyY - 1, box.x + box.width - 12, weeklyY - 1, 1, PALETTE.light);
  drawCodexQuotaRow(ctx, weekly, box.x, weeklyY, box.width, box.y + box.height - weeklyY - 6, '周额度', true);
}`;

const layout = `export function volcengineModelLayoutPlan(boxHeight, modelCount) {
  const count = Math.max(0, Number(modelCount) || 0);
  if (!count) return { hasModels: false, quotaHeight: Math.max(0, boxHeight - 45), columns: 0, rows: 0, capacity: 0, visibleCount: 0, overflowCount: 0, rowHeight: 0, fontSize: 0 };
  const compact = boxHeight < 220;
  const medium = boxHeight < 340;
  const quotaHeight = compact ? 44 : medium ? 60 : 92;
  const sectionGap = compact ? 5 : medium ? 7 : 10;
  const modelHeaderHeight = compact ? 14 : 17;
  const modelAreaHeight = Math.max(28, boxHeight - 39 - quotaHeight - sectionGap - 8);
  const columns = count === 1
    ? 1
    : compact
      ? (count <= 2 ? 1 : 2)
      : (count <= 4 ? 2 : count <= 9 ? 3 : 4);
  const rows = Math.max(1, Math.ceil(count / columns));
  const rowHeight = Math.max(8.5, (modelAreaHeight - modelHeaderHeight) / rows);
  const fontSize = clamp(rowHeight - 1, 8.5, compact ? 10.5 : 12);
  return {
    hasModels: true,
    compact,
    medium,
    quotaHeight,
    sectionGap,
    modelHeaderHeight,
    modelAreaHeight,
    columns,
    rows,
    rowHeight,
    fontSize,
    capacity: count,
    visibleCount: count,
    overflowCount: 0
  };
}`;

const textList = `${marker}
function drawVolcengineModels(ctx, models, box, y, height, plan) {
  drawText(ctx, '今日模型 TOKEN', box.x + 12, y, plan.compact ? 9.5 : 11, 850, 'left', PALETTE.ink);
  drawText(ctx, '今日调用 ' + models.length + ' 个', box.x + box.width - 12, y + 0.5, plan.compact ? 8.5 : 10, 750, 'right', PALETTE.dark);
  const gridY = y + plan.modelHeaderHeight;
  const gridWidth = box.width - 24;
  const columnGap = plan.compact ? 20 : 22;
  const columnWidth = (gridWidth - columnGap * (plan.columns - 1)) / plan.columns;
  const nameSize = plan.fontSize;
  const tokenSize = Math.min(plan.fontSize + 1, plan.compact ? 11.5 : 13);
  const tokenReserve = plan.compact ? 62 : 72;
  const maxNameLength = Math.max(8, Math.floor((columnWidth - tokenReserve) / Math.max(4.7, nameSize * 0.56)));

  models.forEach((model, index) => {
    const column = index % plan.columns;
    const row = Math.floor(index / plan.columns);
    const left = box.x + 12 + column * (columnWidth + columnGap);
    const top = gridY + row * plan.rowHeight;
    if (row > 0) drawLine(ctx, left, top - 1, left + columnWidth, top - 1, 0.8, PALETTE.light);
    const textY = top + Math.max(0, (plan.rowHeight - nameSize) / 2);
    drawText(ctx, shorten(model.name, maxNameLength), left, textY, nameSize, 750, 'left', PALETTE.ink);
    drawText(ctx, formatTokens(model.latestTokens), left + columnWidth, textY - 0.5, tokenSize, 900, 'right', PALETTE.ink);
  });
}`;

const timeFormatter = `const formatTime = value => {
  if (value == null || value === '') return '未同步';
  const raw = typeof value === 'string' ? value.trim() : value;
  let normalized = raw;
  if (typeof raw === 'string' && /^\\d{10}$/.test(raw)) normalized = Number(raw) * 1000;
  else if (typeof raw === 'string' && /^\\d{13}$/.test(raw)) normalized = Number(raw);
  else if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw < 1e12) normalized = raw * 1000;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '未同步';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};`;

const headerFooter = `function sourceSyncText(state, sources) {
  const labels = { codex: 'C', deepseek: 'D', volcengine: 'V' };
  return sources.map(source => labels[source] + ' ' + formatTime(state[source]?.capturedAt || state[source]?.syncRequestedAt)).join('  ·  ');
}

function drawHeader(ctx, state, sources) {
  drawText(ctx, 'AI 用量', 28, 14, 36, 850);
  drawText(ctx, sourceSyncText(state, sources), 572, 28, 11.5, 700, 'right', PALETTE.dark);
  drawLine(ctx, 28, 59, 572, 59, 3);
}

function drawFooter(ctx) {
  ctx.fillStyle = PALETTE.unlock;
  ctx.fillRect(0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockHeight);
  drawLine(ctx, 0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockTop, 2, PALETTE.ink);
}`;

const codexStart = source.includes('function drawCodexQuotaRow(ctx, quota, x, y, width, height, label, primary = false) {')
  ? 'function drawCodexQuotaRow(ctx, quota, x, y, width, height, label, primary = false) {'
  : 'function drawQuota(ctx, quota, x, y, width, height, fallbackLabel) {';
const headerStart = source.includes('function sourceSyncText(state, sources) {')
  ? 'function sourceSyncText(state, sources) {'
  : 'function drawHeader(ctx, sources) {';

source = replaceBlock(source, 'export const KINDLE_LAYOUT = Object.freeze({', 'export const SOURCE_ORDER = Object.freeze(', kindleLayout, 'Kindle canvas layout');
source = replaceBlock(source, 'function preferredHeights(sources) {', 'export function sourceLayoutBoxes(displaySources = {}) {', preferredLayout, 'Source layout heights');
source = replaceBlock(source, codexStart, 'function modelMetrics(deepseek, key) {', codexRenderer, 'Codex quota layout');
source = replaceBlock(source, 'export function volcengineModelLayoutPlan(boxHeight, modelCount) {', 'function drawVolcengineQuotaStrip(ctx, windows, box, y, height) {', layout, 'Volcengine layout');
source = replaceBlock(source, marker, 'function drawVolcengine(ctx, volcengine, box) {', textList, 'Volcengine model list');
source = replaceBlock(source, 'const formatTime = value => {', 'const shorten = (value, maxLength = 24) => {', timeFormatter, 'Sync time formatter');
source = replaceBlock(source, headerStart, 'export function renderKindleDashboard(ctx, state = {}) {', headerFooter, 'Kindle header and footer');

if (source.includes('drawHeader(ctx, sources);')) source = source.replace('drawHeader(ctx, sources);', 'drawHeader(ctx, state, sources);');
if (source.includes('const compact = height < 184;')) source = source.replace('const compact = height < 184;', 'const compact = height < 174;');
if (!source.includes('drawHeader(ctx, state, sources);')) throw new Error('Dashboard must pass state into the compact header');
if (!source.includes('contentTop: 70')) throw new Error('Portrait dashboard content should start below the compact header');
if (!source.includes('contentBottom: 706')) throw new Error('Dashboard should reclaim the old footer timestamp area');
if (!source.includes('codex: 146, deepseek: 332, volcengine: 150')) throw new Error('Three-source layout must preserve Volcengine space while enlarging DeepSeek');
if (!source.includes('const compact = height < 174;')) throw new Error('DeepSeek model cards should use larger typography when the reclaimed space allows it');
if (!source.includes("'5 小时额度'")) throw new Error('Codex must reserve a 5-hour quota row for future API support');
if (!source.includes("quota ? formatPercent(remaining) : '—'")) throw new Error('Missing 5-hour quota must render as a compact placeholder');
if (!source.includes('capturedAt || state[source]?.syncRequestedAt')) throw new Error('Header sync time must prefer successful capture time');
if (!source.includes("/^\\d{10}$/.test(raw)")) throw new Error('Sync time must support Unix-second timestamps');
if (!source.includes('ctx.fillRect(0, KINDLE_LAYOUT.unlockTop, KINDLE_LAYOUT.width, KINDLE_LAYOUT.unlockHeight)')) throw new Error('Kindle unlock shelf must remain intact');
if (!source.includes("drawText(ctx, '今日模型 TOKEN'")) throw new Error('Volcengine today heading missing');
if (!source.includes("'今日调用 ' + models.length + ' 个'")) throw new Error('Volcengine today count missing');
if (!source.includes('formatTokens(model.latestTokens)')) throw new Error('Volcengine latest token value missing');

fs.writeFileSync(rendererPath, source);
console.log('Composed compact portrait Kindle renderer with top sync times and future 5h Codex quota support');