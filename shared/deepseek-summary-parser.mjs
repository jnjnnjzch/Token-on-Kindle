const normalizeLine = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

const SUMMARY_LABEL = /^(cost|api requests|tokens|balance|费用|消耗|请求|余额)$/i;

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
      if (SUMMARY_LABEL.test(candidate)) break;
    }
  }
  return null;
}

function moneyAfterExactLabel(lines, labels) {
  const normalizedLabels = labels.map(label => label.toLowerCase());
  for (let index = 0; index < lines.length; index += 1) {
    if (!normalizedLabels.includes(lines[index].toLowerCase())) continue;

    const nearby = [];
    for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
      const candidate = lines[index + offset];
      if (!candidate) continue;
      if (SUMMARY_LABEL.test(candidate)) break;

      nearby.push(candidate);
      const combined = nearby.join(' ');
      const parsed = money(combined);
      if (parsed != null) {
        return {
          value: parsed,
          raw: combined,
          label: lines[index],
          method: nearby.length === 1 ? 'exact-label' : 'adjacent-lines'
        };
      }
    }
  }
  return null;
}

function inlineMoney(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const beforeAmount = new RegExp(`${escaped}[^¥￥\\d]{0,100}(?:¥|￥|CNY|RMB)\\s*([\\d,.]+)`, 'i');
    const afterAmount = new RegExp(`${escaped}[^\\d]{0,100}([\\d,.]+)\\s*(?:元|CNY|RMB)`, 'i');
    const match = String(text).match(beforeAmount) || String(text).match(afterAmount);
    if (match) return { value: Number(match[1].replaceAll(',', '')), raw: match[0], label, method: 'inline-label' };
  }
  return null;
}

function summaryMoneyMetric(text, lines, labels) {
  return moneyAfterExactLabel(lines, labels) || inlineMoney(text, labels) || null;
}

export function parseDeepSeekSummaryText(text) {
  const rawText = String(text ?? '');
  const lines = rawText.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  return {
    balance: summaryMoneyMetric(rawText, lines, ['Balance', '账户余额', '可用余额', '充值余额', '余额']),
    cost: summaryMoneyMetric(rawText, lines, ['Cost', '费用', '消耗']),
    requests: valueAfterExactLabel(lines, ['API requests', 'API 请求', '请求'], numeric),
    tokens: valueAfterExactLabel(lines, ['Tokens', 'Token'], numeric),
    diagnostics: {
      lineCount: lines.length,
      matchedLabels: lines.filter(line => SUMMARY_LABEL.test(line)).slice(0, 12)
    }
  };
}
