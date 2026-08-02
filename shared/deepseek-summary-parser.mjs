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
      if (parsed != null) return { value: parsed, raw: candidate, label: lines[index] };
      if (/^(cost|api requests|tokens|balance|费用|消耗|请求|余额)$/i.test(candidate)) break;
    }
  }
  return null;
}

export function parseDeepSeekSummaryText(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(normalizeLine).filter(Boolean);
  return {
    balance: valueAfterExactLabel(lines, ['Balance', '余额', '充值余额'], money),
    cost: valueAfterExactLabel(lines, ['Cost', '费用', '消耗'], money),
    requests: valueAfterExactLabel(lines, ['API requests', 'API 请求', '请求'], numeric),
    tokens: valueAfterExactLabel(lines, ['Tokens', 'Token'], numeric),
    diagnostics: {
      lineCount: lines.length,
      matchedLabels: lines.filter(line => /^(cost|api requests|tokens|balance|费用|消耗|请求|余额)$/i.test(line)).slice(0, 12)
    }
  };
}
