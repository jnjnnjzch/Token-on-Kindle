import json
import os
import re
import subprocess
from pathlib import Path

BRANCH = 'agent/dynamic-layout-sync-v082'
ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)


def replace_between(text: str, start: str, end: str, replacement: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f'missing start marker: {start}')
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f'missing end marker: {end}')
    return text[:start_index] + replacement + text[end_index:]


if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_HEAD_REF') == BRANCH:
    subprocess.run(['git', 'fetch', 'origin', BRANCH], check=True)
    subprocess.run(['git', 'checkout', '-B', BRANCH, f'origin/{BRANCH}'], check=True)

renderer_path = Path('web/kindle-renderer.js')
renderer = renderer_path.read_text(encoding='utf-8')

flow_and_cards = r'''export function balancedVerticalFlow(height, blockHeights, options = {}) {
  const padding = options.padding ?? 8;
  const minGap = options.minGap ?? 4;
  const maxGap = options.maxGap ?? 18;
  const blocks = blockHeights.map(value => Math.max(0, Number(value) || 0));
  const gapCount = Math.max(0, blocks.length - 1);
  const innerHeight = Math.max(0, height - padding * 2);
  const blockTotal = blocks.reduce((sum, value) => sum + value, 0);
  const rawGap = gapCount ? (innerHeight - blockTotal) / gapCount : 0;
  const gap = gapCount ? clamp(rawGap, minGap, maxGap) : 0;
  const contentHeight = blockTotal + gap * gapCount;
  const offset = padding + Math.max(0, (innerHeight - contentHeight) / 2);
  let cursor = offset;
  const positions = blocks.map(blockHeight => {
    const position = cursor;
    cursor += blockHeight + gap;
    return position;
  });
  return { positions, gap, offset, contentHeight, innerHeight };
}

export function deepSeekLayoutPlan(boxHeight) {
  const bodyHeight = Math.max(0, boxHeight - 44);
  const summaryHeight = clamp(Math.round(bodyHeight * 0.34), 84, 112);
  const sectionGap = clamp(Math.round(bodyHeight * 0.03), 6, 12);
  const modelHeight = Math.max(146, bodyHeight - summaryHeight - sectionGap);
  return { bodyHeight, summaryHeight, sectionGap, modelHeight };
}

function drawMetricGrid(ctx, metrics, x, y, width, height, columns = 3) {
  const rows = Math.ceil(metrics.length / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const compact = cellHeight < 47;
  const labelSize = compact ? 8.5 : 10.5;
  const valueSize = compact ? 14.5 : 19;
  metrics.forEach(([label, value], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = x + column * cellWidth;
    const top = y + row * cellHeight;
    const center = left + cellWidth / 2;
    if (column > 0) drawLine(ctx, left, top + 5, left, top + cellHeight - 5, 1, PALETTE.dark);
    if (row > 0) drawLine(ctx, left + 5, top, left + cellWidth - 5, top, 1, PALETTE.dark);
    const flow = balancedVerticalFlow(cellHeight, [labelSize + 2, valueSize + 3], {
      padding: compact ? 3 : 5,
      minGap: 2,
      maxGap: 7
    });
    drawText(ctx, label, center, top + flow.positions[0], labelSize, 650, 'center', PALETTE.dark);
    drawText(ctx, value, center, top + flow.positions[1], valueSize, 820, 'center');
  });
}

function drawModelCard(ctx, model, title, x, y, width, height) {
  drawBox(ctx, x, y, width, height, PALETTE.white, PALETTE.dark, 1.5);
  const compact = height < 184;
  const headerHeight = compact ? 15 : 17;
  const totalHeight = compact ? 38 : 46;
  const breakdownHeight = compact ? 39 : 45;
  const cacheHeight = compact ? 24 : 27;
  const flow = balancedVerticalFlow(height, [headerHeight, totalHeight, breakdownHeight, cacheHeight], {
    padding: compact ? 7 : 9,
    minGap: compact ? 4 : 6,
    maxGap: compact ? 11 : 18
  });
  const [headerTop, totalTop, breakdownTop, cacheTop] = flow.positions.map(position => y + position);

  drawText(ctx, title, x + 10, headerTop, compact ? 10.5 : 11, 800);
  drawText(ctx, formatMoney(model.cost), x + width - 10, headerTop - 1, compact ? 11.5 : 12, 800, 'right');

  drawText(ctx, formatTokens(model.tokens), x + 10, totalTop, compact ? 21 : 25, 850);
  drawText(ctx, '总 TOKEN', x + 10, totalTop + (compact ? 25 : 30), 8, 650, 'left', PALETTE.dark);

  drawLine(ctx, x + 10, breakdownTop - Math.max(2, flow.gap / 2), x + width - 10, breakdownTop - Math.max(2, flow.gap / 2), 1, PALETTE.dark);
  const parts = [
    ['未缓存', model.cacheMissTokens],
    ['已缓存', model.cacheHitTokens],
    ['输出', model.outputTokens]
  ];
  const innerWidth = width - 20;
  parts.forEach(([label, value], index) => {
    const center = x + 10 + (index + 0.5) * (innerWidth / 3);
    const partFlow = balancedVerticalFlow(breakdownHeight, [10, compact ? 14 : 16], {
      padding: 1,
      minGap: 2,
      maxGap: 5
    });
    drawText(ctx, label, center, breakdownTop + partFlow.positions[0], 8, 650, 'center', PALETTE.dark);
    drawText(ctx, formatTokens(value), center, breakdownTop + partFlow.positions[1], compact ? 11.5 : 13, 800, 'center');
    if (index > 0) {
      const lineX = x + 10 + index * (innerWidth / 3);
      drawLine(ctx, lineX, breakdownTop + 2, lineX, breakdownTop + breakdownHeight - 2, 1, PALETTE.light);
    }
  });

  drawText(ctx, '缓存率', x + 10, cacheTop, 9, 650, 'left', PALETTE.dark);
  drawText(ctx, formatPercent(model.cacheRate), x + width - 10, cacheTop, 9.5, 750, 'right', PALETTE.dark);
  drawBar(ctx, x + 10, cacheTop + cacheHeight - 8, width - 20, 7, cacheRateToRatio(model.cacheRate));
}

'''
renderer = replace_between(renderer, 'function drawMetricGrid(', 'function drawDeepSeek(', flow_and_cards)

deepseek_function = r'''function drawDeepSeek(ctx, deepseek = {}, box) {
  drawBox(ctx, box.x, box.y, box.width, box.height, PALETTE.paper, PALETTE.ink, 2);
  drawCardTitle(ctx, 'DEEPSEEK', box, '金额 · Flash / Pro Token');
  const flash = modelMetrics(deepseek, 'flash');
  const pro = modelMetrics(deepseek, 'pro');
  const monthly = deepSeekMonthlyMetrics(deepseek);
  const todayTokens = numericValue(deepseek.todayTokens) ?? ([flash.tokens, pro.tokens].some(value => value != null) ? (flash.tokens || 0) + (pro.tokens || 0) : null);
  const todayCost = numericValue(deepseek.todayCost) ?? ([flash.cost, pro.cost].some(value => value != null) ? (flash.cost || 0) + (pro.cost || 0) : null);
  const metrics = [
    ['余额', formatMoney(deepseek.balance)],
    ['今日费用', formatMoney(todayCost)],
    ['今日 Token', formatTokens(todayTokens)],
    ['累计费用', formatMoney(monthly.cumulativeCost)],
    ['本月费用', formatMoney(monthly.monthlyCost)],
    ['本月 Token', formatTokens(monthly.monthlyTokens)]
  ];
  const plan = deepSeekLayoutPlan(box.height);
  const bodyY = box.y + 38;
  drawMetricGrid(ctx, metrics, box.x + 8, bodyY, box.width - 16, plan.summaryHeight, 3);
  const modelY = bodyY + plan.summaryHeight + plan.sectionGap;
  const half = (box.width - 24) / 2;
  drawModelCard(ctx, flash, 'V4 FLASH', box.x + 8, modelY, half, plan.modelHeight);
  drawModelCard(ctx, pro, 'V4 PRO', box.x + 16 + half, modelY, half, plan.modelHeight);
}

'''
renderer = replace_between(renderer, 'function drawDeepSeek(', 'function normalizeVolcengineWindows(', deepseek_function)
renderer = renderer.replace(
    "const text = sources.map(source => `${labels[source]} ${formatTime(state[source]?.capturedAt)}`).join('  ·  ');",
    "const text = sources.map(source => `${labels[source]} ${formatTime(state[source]?.syncRequestedAt || state[source]?.capturedAt)}`).join('  ·  ');"
)
renderer_path.write_text(renderer, encoding='utf-8')

# Centralize refresh cadence in the native scheduler and pass one shared batch timestamp.
lib_path = Path('src-tauri/src/lib.rs')
lib = lib_path.read_text(encoding='utf-8')
start = '#[cfg(not(any(target_os = "android", target_os = "ios")))]\nfn background_refresh_window'
end = '#[cfg(any(target_os = "android", target_os = "ios"))]\nfn reload_sources'
replacement = r'''#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn background_refresh_window(
    window: &WebviewWindow,
    reload_page: bool,
    refresh_minutes: u64,
    sync_requested_at: &str,
) -> Result<(), String> {
    let sync_script = format!(
        "window.__TOKEN_ON_KINDLE_SYNC__?.({{ automatic: true, refreshMinutes: {refresh_minutes}, syncRequestedAt: \"{sync_requested_at}\" }})"
    );
    if window.is_focused().unwrap_or(false) {
        return window.eval(&sync_script).map_err(|error| error.to_string());
    }

    let _ = window.hide();
    if reload_page {
        let reload_script = format!(
            "sessionStorage.setItem('__token_on_kindle_refresh_minutes', '{refresh_minutes}');sessionStorage.setItem('__token_on_kindle_sync_requested_at', '{sync_requested_at}');window.blur();location.reload()"
        );
        window.eval(&reload_script).map_err(|error| error.to_string())?;
    } else {
        window.eval(&sync_script).map_err(|error| error.to_string())?;
    }
    let _ = window.hide();
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reload_sources(app: &AppHandle) -> Result<(), String> {
    let refresh_minutes = app.state::<AppState>().refresh.get();
    let sync_requested_at = timestamp();
    let mut refreshed = 0;
    for label in ["codex-login", "deepseek-login"] {
        if let Some(window) = app.get_webview_window(label) {
            background_refresh_window(&window, true, refresh_minutes, &sync_requested_at)?;
            refreshed += 1;
        }
    }
    if let Some(window) = app.get_webview_window("volcengine-login") {
        background_refresh_window(&window, false, refresh_minutes, &sync_requested_at)?;
        refreshed += 1;
    }
    if refreshed == 0 {
        return Err("没有可刷新的后台窗口".into());
    }
    Ok(())
}

'''
lib = replace_between(lib, start, end, replacement)
lib_path.write_text(lib, encoding='utf-8')

# Remove page-local recurring timers and carry the native scheduler context in every payload.
for extractor_path in [Path('web/extractor-base.js'), Path('web/extractor.js')]:
    extractor = extractor_path.read_text(encoding='utf-8')
    extractor = extractor.replace('  const UPDATE_MS = 10 * 60 * 1000;\n', '')
    anchor = "  const pageLines = () => clean(document.body?.innerText || '').split(/\\n+/).map(clean).filter(Boolean);\n"
    sync_context = anchor + r'''
  const syncState = {
    refreshMinutes: numeric(sessionStorage.getItem('__token_on_kindle_refresh_minutes')),
    syncRequestedAt: sessionStorage.getItem('__token_on_kindle_sync_requested_at') || null
  };

  function applySyncOptions(options = {}) {
    const refreshMinutes = numeric(options.refreshMinutes);
    if (refreshMinutes != null) {
      syncState.refreshMinutes = refreshMinutes;
      sessionStorage.setItem('__token_on_kindle_refresh_minutes', String(refreshMinutes));
    }
    if (options.syncRequestedAt) {
      syncState.syncRequestedAt = String(options.syncRequestedAt);
      sessionStorage.setItem('__token_on_kindle_sync_requested_at', syncState.syncRequestedAt);
    }
  }
'''
    if 'const syncState = {' not in extractor:
        if anchor not in extractor:
            raise SystemExit(f'sync context anchor missing in {extractor_path}')
        extractor = extractor.replace(anchor, sync_context, 1)
    extractor = extractor.replace(
        'const bytes = new TextEncoder().encode(JSON.stringify(payload));',
        "const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, updateIntervalMinutes: syncState.refreshMinutes, syncRequestedAt: syncState.syncRequestedAt }));",
        1
    )
    extractor = re.sub(r'\n\s*updateIntervalMinutes:\s*10,', '', extractor)
    extractor = extractor.replace('  async function collectAndSignal() {', '  async function collectAndSignal(options = {}) {', 1)
    extractor = extractor.replace(
        '    if (collecting) return;\n    collecting = true;',
        '    if (collecting) return;\n    applySyncOptions(options);\n    collecting = true;',
        1
    )
    extractor = extractor.replace('      await originalCollectAndSignal();', '      await originalCollectAndSignal(options);', 1)
    extractor = extractor.replace(
        "    const marker = location.href + '|' + (document.body?.innerText?.length || 0);",
        '    const marker = location.href;'
    )
    extractor = re.sub(r"\n\s*setInterval\(\(\) => collectAndSignal\(\{ automatic: true \}\), UPDATE_MS\);", '', extractor)
    extractor_path.write_text(extractor, encoding='utf-8')

Path('tests/dynamic-layout-sync-v082.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { balancedVerticalFlow, deepSeekLayoutPlan } from '../web/kindle-renderer.js';

const renderer = fs.readFileSync(new URL('../web/kindle-renderer.js', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor-base.js', import.meta.url), 'utf8');
const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('balanced vertical flow keeps internal gaps equal and bounded', () => {
  const compact = balancedVerticalFlow(160, [15, 38, 39, 24], { padding: 7, minGap: 4, maxGap: 11 });
  assert.ok(compact.gap >= 4 && compact.gap <= 11);
  const positions = compact.positions;
  const gaps = positions.slice(1).map((position, index) => position - positions[index] - [15, 38, 39][index]);
  gaps.forEach(gap => assert.ok(Math.abs(gap - compact.gap) < 0.001));

  const spacious = balancedVerticalFlow(420, [17, 46, 45, 27], { padding: 9, minGap: 6, maxGap: 18 });
  assert.equal(spacious.gap, 18);
  assert.ok(spacious.offset > 9, 'surplus space should center the content group instead of creating one giant gap');
});

test('DeepSeek summary and model sections adapt across all card heights', () => {
  const compact = deepSeekLayoutPlan(294);
  const medium = deepSeekLayoutPlan(348);
  const full = deepSeekLayoutPlan(584);
  assert.deepEqual(compact, { bodyHeight: 250, summaryHeight: 85, sectionGap: 8, modelHeight: 157 });
  assert.ok(medium.summaryHeight > compact.summaryHeight);
  assert.ok(medium.modelHeight > compact.modelHeight);
  assert.equal(full.summaryHeight, 112);
  assert.ok(full.modelHeight > 400);
  assert.match(renderer, /balancedVerticalFlow\(cellHeight/);
  assert.match(renderer, /balancedVerticalFlow\(height, \[headerHeight, totalHeight, breakdownHeight, cacheHeight\]/);
});

test('all sources share the native refresh batch and no page owns a recurring timer', () => {
  assert.doesNotMatch(extractor, /UPDATE_MS|setInterval\(\(\) => collectAndSignal/);
  assert.match(extractor, /updateIntervalMinutes: syncState\.refreshMinutes/);
  assert.match(extractor, /syncRequestedAt: syncState\.syncRequestedAt/);
  assert.match(extractor, /const marker = location\.href;/);
  assert.doesNotMatch(extractor, /document\.body\?\.innerText\?\.length/);
  assert.match(native, /let sync_requested_at = timestamp\(\);/);
  assert.match(native, /background_refresh_window\(&window, true, refresh_minutes, &sync_requested_at\)/);
  assert.match(native, /background_refresh_window\(&window, false, refresh_minutes, &sync_requested_at\)/);
  assert.match(renderer, /syncRequestedAt \|\| state\[source\]\?\.capturedAt/);
});
''', encoding='utf-8')

Path('docs/v0.8.2.md').write_text('''# v0.8.2\n\n- DeepSeek model cards use a reusable balanced vertical-flow algorithm instead of fixed pixel offsets.\n- Summary cells, model totals, cache breakdowns, and cache bars distribute available space evenly and center bounded content on tall Kindle layouts.\n- The native application refresh scheduler is the only recurring source timer.\n- Codex, DeepSeek, and Volcengine receive the same refresh interval and batch timestamp.\n- Volcengine auto-captures once when an AFP usage view is recognized, then follows the same application refresh cadence as the other sources.\n''', encoding='utf-8')

subprocess.run(['node', 'tools/sync-version.mjs', 'v0.8.2'], check=True)

package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
prefix = 'python3 tools/materialize-v082.py && '
if package['scripts']['test'].startswith(prefix):
    package['scripts']['test'] = package['scripts']['test'][len(prefix):]
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Validate the fully materialized tree before publishing it to the PR branch.
subprocess.run(['npm', 'test'], check=True)

if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_HEAD_REF') == BRANCH:
    Path('tools/materialize-v082.py').unlink(missing_ok=True)
    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
    subprocess.run(['git', 'add', '-A'], check=True)
    subprocess.run(['git', 'commit', '-m', 'v0.8.2: balance DeepSeek layout and synchronize refresh cycles'], check=True)
    subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'], check=True)
