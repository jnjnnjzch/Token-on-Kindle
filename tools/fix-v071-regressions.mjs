import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const write = (relative, content) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) fs.writeFileSync(target, content);
};
const replacePattern = (text, pattern, replacement, label) => {
  if (!pattern.test(text)) throw new Error(`v0.7.1 repair target missing: ${label}`);
  return text.replace(pattern, replacement);
};

let extractor = read('web/extractor.js');
if (!extractor.includes('function activateVolcengineUsageTab()')) {
  const parser = read('shared/volcengine-text-parser.mjs').replaceAll('export ', '');
  const collector = `${parser}\n
  const compactText = value => clean(value).replace(/\\s+/g, '');

  function volcLabelElement(label) {
    const wanted = compactText(label);
    return [...document.querySelectorAll('span,div,p,label,h1,h2,h3,h4,button')]
      .filter(element => compactText(element.textContent) === wanted)
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length)[0] || null;
  }

  function activateVolcengineUsageTab() {
    if (source !== 'volcengine') return false;
    if (volcLabelElement('近5小时用量') || volcLabelElement('近一周用量')) return true;
    const button = [...document.querySelectorAll('button,[role="tab"]')]
      .find(element => compactText(element.textContent) === '用量统计');
    if (!button) return false;
    button.click();
    return true;
  }

  function closestVolcengineItem(labelElement, label) {
    let node = labelElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      const hasProgress = Boolean(node.querySelector?.('[role="progressbar"][aria-valuenow], [aria-valuenow]'));
      const hasAmounts = node.querySelectorAll?.('[title]').length >= 2
        || /\\d[\\d,.]*\\s*\\/\\s*\\d[\\d,.]*\\s*万?/.test(text);
      if (compactText(text).includes(compactText(label)) && hasAmounts && (/已使用/.test(text) || hasProgress)) return node;
    }
    return labelElement.parentElement;
  }

  function collectVolcengineQuota(label, id) {
    const labelElement = volcLabelElement(label);
    if (labelElement) {
      const item = closestVolcengineItem(labelElement, label);
      const titled = [...(item?.querySelectorAll?.('[title]') || [])]
        .map(element => clean(element.getAttribute('title')))
        .filter(value => parseVolcengineAmount(value) != null);
      const text = clean(item?.innerText || item?.textContent || '');
      const fallback = parseVolcengineQuotaText(text, { label, id });
      const used = parseVolcengineAmount(titled[0]) ?? fallback?.used ?? null;
      const total = parseVolcengineAmount(titled[1]) ?? fallback?.total ?? null;
      const progress = item?.querySelector?.('[role="progressbar"][aria-valuenow], [aria-valuenow]');
      const usedPercent = number(progress?.getAttribute('aria-valuenow'))
        ?? fallback?.usedPercent
        ?? (used != null && total ? used / total * 100 : null);
      if (used != null || total != null || usedPercent != null) {
        return {
          id,
          label: label.replace('用量', ''),
          used,
          total,
          usedPercent,
          remainingPercent: usedPercent == null ? null : 100 - usedPercent,
          resetText: fallback?.resetText || null
        };
      }
    }

    const body = clean(document.body?.innerText || document.body?.textContent || '');
    const labels = ['近5小时用量', '近一周用量', '近一月用量'];
    const start = body.indexOf(label);
    if (start < 0) return null;
    const next = labels
      .map(candidate => body.indexOf(candidate, start + label.length))
      .filter(index => index > start)
      .sort((a, b) => a - b)[0];
    return parseVolcengineQuotaText(
      body.slice(start, next > start ? next : start + 240),
      { label, id }
    );
  }

  function collectVolcengine() {
    activateVolcengineUsageTab();
    const quotas = [
      collectVolcengineQuota('近5小时用量', '5h'),
      collectVolcengineQuota('近一周用量', 'weekly'),
      collectVolcengineQuota('近一月用量', 'monthly')
    ].filter(Boolean);
    const bodyText = clean(document.body?.innerText || document.body?.textContent || '');
    return {
      source,
      capturedAt: new Date().toISOString(),
      updateIntervalMinutes: 10,
      unit: 'AFP',
      plan: pageLines().find(line => /套餐$/.test(line)) || null,
      quotas,
      url: location.href,
      diagnostics: {
        primarySource: quotas.length ? 'semantic-dom-and-text' : 'waiting-for-usage-tab',
        quotaCount: quotas.length,
        usageTabVisible: /近5小时用量|近一周用量|近一月用量/.test(bodyText)
      }
    };
  }
`;
  extractor = replacePattern(
    extractor,
    /  function closestUsageItem[\s\S]*?\n  let collecting = false;/,
    `${collector}\n  let collecting = false;`,
    'Volcengine collector'
  );
}

if (extractor.includes('let boardSeen = false')) {
  extractor = replacePattern(
    extractor,
    /  let boardSeen = false;[\s\S]*?\n  const start = \(\) => \{[\s\S]*?\n  \};/,
    `  let collectTimer = null;
  const scheduleCollect = (delay = 900) => {
    clearTimeout(collectTimer);
    collectTimer = setTimeout(collect, delay);
  };

  const observer = new MutationObserver(() => {
    toolbar();
    const bodyText = document.body?.innerText || '';
    if (source === 'volcengine') activateVolcengineUsageTab();
    const ready = source === 'codex'
      ? /%/.test(bodyText)
      : source === 'deepseek'
        ? Boolean(document.querySelector('#usage-board'))
        : /近5小时用量|近一周用量|近一月用量/.test(bodyText);
    if (ready) scheduleCollect(700);
  });

  const start = () => {
    toolbar();
    if (source === 'volcengine') activateVolcengineUsageTab();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleCollect(2500);
    if (source === 'volcengine') {
      setInterval(() => {
        activateVolcengineUsageTab();
        collect();
      }, 15 * 1000);
    }
    setInterval(() => location.reload(), UPDATE_MS);
  };`,
    'Volcengine retry scheduler'
  );
}
write('web/extractor.js', extractor);

let renderer = read('web/kindle-renderer.js');
if (!renderer.includes('export function codexQuotaLayout')) {
  renderer = replacePattern(
    renderer,
    /(export function selectCodexQuotas[\s\S]*?\n\})\n\nexport function deepSeekMonthlyMetrics/,
    `$1\n\nexport function codexQuotaLayout(codex = {}) {
  const { weekly, hourly } = selectCodexQuotas(codex);
  const entries = [
    weekly ? [weekly, '周额度'] : null,
    hourly ? [hourly, '5 小时'] : null
  ].filter(Boolean);
  if (!entries.length) entries.push([null, '额度']);
  return { entries, columns: entries.length >= 2 ? 2 : 1 };
}\n\nexport function deepSeekMonthlyMetrics`,
    'Codex adaptive layout helper'
  );
}
renderer = replacePattern(
  renderer,
  /function drawCodexCard[\s\S]*?\n\}\n\nfunction drawDeepSeekSummary/,
  `function drawCodexCard(ctx, codex, y) {
  const height = 112;
  drawBox(ctx, 28, y, 544, height, PALETTE.white, PALETTE.ink, 2);
  drawText(ctx, 'CODEX', 42, y + 9, 14, 800);
  const { entries, columns } = codexQuotaLayout(codex);
  const contentWidth = columns === 1 ? 516 : 230;
  const step = columns === 1 ? 0 : 258;
  entries.forEach(([quota, fallback], index) => {
    const x = 42 + index * step;
    if (columns > 1 && index) drawLine(ctx, 300, y + 14, 300, y + height - 12, 1.5, PALETTE.dark);
    drawText(ctx, quotaLabel(quota, fallback), x, y + 31, 12, 700, 'left', PALETTE.dark);
    if (!quota) {
      drawText(ctx, '未同步', x, y + 51, 24, 800);
      return;
    }
    const remaining = quotaRemaining(quota);
    drawText(ctx, formatPercent(remaining), x + contentWidth, y + 26, 27, 850, 'right');
    drawBar(ctx, x, y + 61, contentWidth, 11, remaining == null ? 0 : remaining / 100);
    drawText(
      ctx,
      quota.resetText ? shorten(quota.resetText, columns === 1 ? 55 : 29) : '重置时间未知',
      x,
      y + 80,
      10,
      600,
      'left',
      PALETTE.dark
    );
  });
  return height;
}\n\nfunction drawDeepSeekSummary`,
  'Codex adaptive card'
);
write('web/kindle-renderer.js', renderer);

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
let cargo = read('src-tauri/Cargo.toml');
cargo = cargo.replace(/(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
write('src-tauri/Cargo.toml', cargo);
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
tauri.version = version;
write('src-tauri/tauri.conf.json', `${JSON.stringify(tauri, null, 2)}\n`);
write('web/version.js', `// Generated from package.json. Do not edit manually.\nexport const APP_VERSION = "${version}";\n`);
write('tests/version-target.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\n\nconst pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));\n\ntest('generated application version follows package.json', () => {\n  assert.equal(pkg.version, '${version}');\n});\n`);

console.log(`Applied v${version} Volcengine retry and Codex adaptive layout repairs.`);
