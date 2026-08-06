import { readFile, writeFile } from 'node:fs/promises';

const extractorUrl = new URL('../web/extractor.js', import.meta.url);
const coreUrl = new URL('../shared/volcengine-debug-core.mjs', import.meta.url);
const probeUrl = new URL('../web/volcengine-debug-probe.js', import.meta.url);
const START = '/* TOKEN-ON-KINDLE VOLCENGINE DEBUG START */';
const END = '/* TOKEN-ON-KINDLE VOLCENGINE DEBUG END */';
const lf = value => String(value || '').replaceAll('\r\n', '\n');

function stripExistingDebug(source) {
  const start = source.indexOf(START);
  if (start < 0) return source.trimEnd();
  const end = source.indexOf(END, start);
  if (end < 0) throw new Error('Volcengine debug end marker missing');
  return `${source.slice(0, start)}${source.slice(end + END.length)}`.trimEnd();
}

export async function composeVolcengineDebug({ write = true } = {}) {
  const [extractorRaw, coreRaw, probeRaw] = await Promise.all([
    readFile(extractorUrl, 'utf8'),
    readFile(coreUrl, 'utf8'),
    readFile(probeUrl, 'utf8')
  ]);
  const extractor = stripExistingDebug(lf(extractorRaw));
  const core = lf(coreRaw).replace(/^export\s+/gm, '');
  const probe = lf(probeRaw).trim();
  const coreBootstrap = `(() => {
  'use strict';
  if (!location.hostname.endsWith('volcengine.com')) return;
${core}
  window.__TOKEN_ON_KINDLE_VOLCENGINE_DEBUG_CORE__ = {
    sanitizeVolcengineUrl,
    summarizeVolcengineRequestBody,
    collectVolcengineJsonPaths,
    classifyVolcengineDebugPayload,
    isSafeVolcengineReplayCandidate,
    compareVolcengineDebugResults
  };
})();`;
  const output = `${extractor}\n${START}\n${coreBootstrap}\n${probe}\n${END}\n`;

  if (!output.includes('__TOKEN_ON_KINDLE_VOLCENGINE_DEBUG_CORE__')) throw new Error('Volcengine debug core missing');
  if (!output.includes('__TOKEN_ON_KINDLE_VOLCENGINE_DEBUG__')) throw new Error('Volcengine debug probe missing');
  if (!output.includes('isSafeVolcengineReplayCandidate')) throw new Error('safe replay guard missing');
  if (!output.includes('MAX_ENTRIES = 60')) throw new Error('bounded capture missing');
  if (output.includes('__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__')) throw new Error('legacy full-response cache restored');
  new Function(output);

  if (write && lf(extractorRaw) !== output) await writeFile(extractorUrl, output);
  return output;
}

const args = new Set(process.argv.slice(2));
if (args.has('--remove')) {
  const current = lf(await readFile(extractorUrl, 'utf8'));
  const clean = `${stripExistingDebug(current)}\n`;
  if (current !== clean) await writeFile(extractorUrl, clean);
  console.log('Removed Volcengine debug probe');
} else {
  await composeVolcengineDebug({ write: !args.has('--check') });
  console.log(args.has('--check') ? 'Validated Volcengine debug probe' : 'Composed Volcengine debug probe');
}
