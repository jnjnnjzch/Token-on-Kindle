const normalizeLine = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

function numeric(value) {
  const match = String(value ?? '').replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function money(value) {
  const compact = String(value ?? '').replaceAll(',', '');
  const match = compact.match(/(?:¥|￥|CNY|RMB)\s*(-?\d+(?:\.\d+)?)/i)
    || compact.match(/(-?\d+(?:\.\d+)?)\s*(?:元|CNY|RMB)/i);
  return match ? Number(match[1]) : null;
}

function valueAfterExactLabel(lines, labels, parser) {
  const normalizedLabels = labels.map(label => label.toLowerCase());
  for (let index = 0; index < lines.length; index += 1) {
    if (!normalizedLabels.includes(lines[index].toLowerCase())) continue;
    for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate) continue;
      const parsed = parser(candidate);
      if (parsed != null) return { value: parsed, raw: candidate, label: lines[index], method: 'exact-label' };
      if (/^(cost|api requests|tokens|balance|费用|消耗|请求|余额)$/i.test(candidate)) break;
    }
  }
  return null;
}

function inlineMoney(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}[^¥￥\\d]{0,100}(?:¥|￥|CNY|RMB)\\s*([\\d,.]+)`, 'i');
    const match = String(text).match(pattern);
    if (match) return { value: Number(match[1].replaceAll(',', '')), raw: match[0], label, method: 'inline-label' };
  }
  return null;
}

function summaryMetric(text, lines, labels, parser, inlineParser = null) {
  return valueAfterExactLabel(lines, labels, parser) || inlineParser?.(text, labels) || null;
}

export function parseDeepSeekSummaryText(text) {
  const rawText = String(text ?? '');
  const lines = rawText.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  return {
    balance: summaryMetric(rawText, lines, ['Balance', '账户余额', '可用余额', '充值余额', '余额'], money, inlineMoney),
    cost: summaryMetric(rawText, lines, ['Cost', '费用', '消耗'], money, inlineMoney),
    requests: valueAfterExactLabel(lines, ['API requests', 'API 请求', '请求'], numeric),
    tokens: valueAfterExactLabel(lines, ['Tokens', 'Token'], numeric),
    diagnostics: {
      lineCount: lines.length,
      matchedLabels: lines.filter(line => /^(cost|api requests|tokens|balance|费用|消耗|请求|余额)$/i.test(line)).slice(0, 12)
    }
  };
}
