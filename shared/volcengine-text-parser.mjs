const normalizeVolcengineText = value => String(value ?? '')
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .trim();

export function parseVolcengineAmount(value) {
  const text = normalizeVolcengineText(value).replaceAll(',', '');
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return parsed * (/万/.test(text) ? 10000 : 1);
}

export function parseVolcengineQuotaText(text, { label, id }) {
  const normalized = normalizeVolcengineText(text);
  const fraction = normalized.match(/([\d,.]+)\s*\/\s*([\d,.]+\s*万?)/);
  const used = parseVolcengineAmount(fraction?.[1]);
  const total = parseVolcengineAmount(fraction?.[2]);
  const percentMatch = normalized.match(/已使用\s*(\d+(?:\.\d+)?)\s*%/);
  const usedPercent = percentMatch
    ? Number(percentMatch[1])
    : used != null && total
      ? used / total * 100
      : null;
  const resetText = normalized.match(
    /((?:\d+天)?(?:\d+小时)?(?:\d+分钟)?后重置)/
  )?.[1] || null;

  if (used == null && total == null && usedPercent == null) return null;
  return {
    id,
    label: label.replace('用量', ''),
    used,
    total,
    usedPercent,
    remainingPercent: usedPercent == null ? null : 100 - usedPercent,
    resetText
  };
}
