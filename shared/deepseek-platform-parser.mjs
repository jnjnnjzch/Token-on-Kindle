const finite = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(number) ? number : null;
};

function unwrap(body, label) {
  if (!body || typeof body !== 'object') throw new Error(`${label}: missing response`);
  if (body.code != null && Number(body.code) !== 0) throw new Error(`${label}: code ${body.code}`);
  const data = body.data;
  if (!data || typeof data !== 'object') throw new Error(`${label}: missing data`);
  if (data.biz_code != null && Number(data.biz_code) !== 0) throw new Error(`${label}: biz_code ${data.biz_code}`);
  return data.biz_data;
}

function dateLocal(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateUtc(now) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function chooseDate(amountDays, costDays, now) {
  const dates = new Set([
    ...amountDays.map(day => String(day?.date || '')).filter(Boolean),
    ...costDays.map(day => String(day?.date || '')).filter(Boolean)
  ]);
  for (const candidate of [dateLocal(now), dateUtc(now)]) {
    if (dates.has(candidate)) return candidate;
  }
  return [...dates].sort().at(-1) || dateLocal(now);
}

function modelKey(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('v4-flash') || /(^|[-_])flash($|[-_])/.test(text)) return 'flash';
  if (text.includes('v4-pro') || /(^|[-_])pro($|[-_])/.test(text)) return 'pro';
  return null;
}

function usageMap(day) {
  const map = new Map();
  for (const model of day?.data || []) {
    const name = String(model?.model || '');
    if (!name) continue;
    map.set(name, Array.isArray(model.usage) ? model.usage : []);
  }
  return map;
}

function tokenBreakdown(items) {
  const result = {
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    outputTokens: 0,
    requests: 0,
    tokens: 0,
    hasTokenData: false,
    hasRequestData: false
  };
  for (const item of items || []) {
    const type = String(item?.type || '').toUpperCase();
    const amount = finite(item?.amount);
    if (amount == null || amount < 0) continue;
    if (type === 'REQUEST') {
      result.requests += amount;
      result.hasRequestData = true;
      continue;
    }
    if (type === 'PROMPT_CACHE_HIT_TOKEN') result.cacheHitTokens += amount;
    else if (type === 'PROMPT_CACHE_MISS_TOKEN') result.cacheMissTokens += amount;
    else if (type === 'RESPONSE_TOKEN') result.outputTokens += amount;
    else if (!type.includes('TOKEN')) continue;
    result.tokens += amount;
    result.hasTokenData = true;
  }
  return result;
}

function costBreakdown(items) {
  let cost = 0;
  let hasCostData = false;
  for (const item of items || []) {
    const type = String(item?.type || '').toUpperCase();
    const amount = finite(item?.amount);
    if (amount == null || amount < 0 || type === 'REQUEST') continue;
    cost += amount;
    hasCostData = true;
  }
  return { cost, hasCostData };
}

function aggregateTokenDays(days) {
  const result = {
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    outputTokens: 0,
    requests: 0,
    tokens: 0,
    hasTokenData: false,
    hasRequestData: false
  };
  for (const day of days || []) {
    for (const model of day?.data || []) {
      const current = tokenBreakdown(model?.usage);
      result.cacheHitTokens += current.cacheHitTokens;
      result.cacheMissTokens += current.cacheMissTokens;
      result.outputTokens += current.outputTokens;
      result.requests += current.requests;
      result.tokens += current.tokens;
      result.hasTokenData ||= current.hasTokenData;
      result.hasRequestData ||= current.hasRequestData;
    }
  }
  return result;
}

function aggregateCostDays(days) {
  let cost = 0;
  let hasCostData = false;
  for (const day of days || []) {
    for (const model of day?.data || []) {
      const current = costBreakdown(model?.usage);
      cost += current.cost;
      hasCostData ||= current.hasCostData;
    }
  }
  return { cost, hasCostData };
}

function parseBalance(summaryBody) {
  const summary = unwrap(summaryBody, 'summary');
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new Error('summary: malformed biz_data');
  const normal = Array.isArray(summary.normal_wallets) ? summary.normal_wallets : [];
  const bonus = Array.isArray(summary.bonus_wallets) ? summary.bonus_wallets : [];
  const currencies = new Set([...normal, ...bonus].map(wallet => wallet?.currency).filter(Boolean));
  const currency = currencies.has('CNY') ? 'CNY' : [...currencies][0] || 'CNY';
  const toppedUp = normal.filter(wallet => wallet?.currency === currency).reduce((sum, wallet) => sum + (finite(wallet.balance) || 0), 0);
  const granted = bonus.filter(wallet => wallet?.currency === currency).reduce((sum, wallet) => sum + (finite(wallet.balance) || 0), 0);
  return {
    value: toppedUp + granted,
    currency,
    toppedUp,
    granted,
    monthlyCost: finite(summary.monthly_costs?.[0]?.amount),
    cumulativeCost: finite(summary.total_costs?.[0]?.amount),
    monthlyTokens: finite(summary.monthly_token_usage),
    monthlyRequests: finite(summary.total_usage)
  };
}

export function parseDeepSeekPlatformPayloads({ summaryBody, amountBody, costBody, now = new Date() }) {
  const amountBiz = unwrap(amountBody, 'amount');
  if (!amountBiz || typeof amountBiz !== 'object' || Array.isArray(amountBiz)) throw new Error('amount: malformed biz_data');
  const costBiz = unwrap(costBody, 'cost');
  if (!Array.isArray(costBiz)) throw new Error('cost: malformed biz_data');

  const amountDays = Array.isArray(amountBiz.days) ? amountBiz.days : [];
  const selectedCostBucket = costBiz.find(item => item?.currency === 'CNY') || costBiz[0] || {};
  const costDays = Array.isArray(selectedCostBucket.days) ? selectedCostBucket.days : [];
  const date = chooseDate(amountDays, costDays, now);
  const amountModels = usageMap(amountDays.find(day => day?.date === date));
  const costModels = usageMap(costDays.find(day => day?.date === date));
  const allModelNames = new Set([...amountModels.keys(), ...costModels.keys()]);

  const models = {
    flash: { name: 'deepseek-v4-flash', date, tokens: null, cost: null, cacheHitTokens: null, cacheMissTokens: null, outputTokens: null, cacheRate: null, requests: null },
    pro: { name: 'deepseek-v4-pro', date, tokens: null, cost: null, cacheHitTokens: null, cacheMissTokens: null, outputTokens: null, cacheRate: null, requests: null }
  };

  let todayTokens = 0;
  let todayCost = 0;
  let todayRequests = 0;
  let totalHit = 0;
  let totalMiss = 0;
  let hasTokens = false;
  let hasCost = false;
  let hasRequests = false;

  for (const name of allModelNames) {
    const token = tokenBreakdown(amountModels.get(name));
    const cost = costBreakdown(costModels.get(name));
    if (token.hasTokenData) { todayTokens += token.tokens; hasTokens = true; }
    if (token.hasRequestData) { todayRequests += token.requests; hasRequests = true; }
    if (cost.hasCostData) { todayCost += cost.cost; hasCost = true; }
    totalHit += token.cacheHitTokens;
    totalMiss += token.cacheMissTokens;

    const key = modelKey(name);
    if (!key) continue;
    models[key] = {
      name,
      date,
      tokens: token.hasTokenData ? token.tokens : null,
      cost: cost.hasCostData ? cost.cost : null,
      cacheHitTokens: token.hasTokenData ? token.cacheHitTokens : null,
      cacheMissTokens: token.hasTokenData ? token.cacheMissTokens : null,
      outputTokens: token.hasTokenData ? token.outputTokens : null,
      cacheRate: token.cacheHitTokens + token.cacheMissTokens > 0
        ? token.cacheHitTokens / (token.cacheHitTokens + token.cacheMissTokens) * 100
        : null,
      requests: token.hasRequestData ? token.requests : null
    };
  }

  const balance = parseBalance(summaryBody);
  const monthlyTokenTotals = aggregateTokenDays(amountDays);
  const monthlyCostTotals = aggregateCostDays(costDays);
  const monthlyCost = monthlyCostTotals.hasCostData ? monthlyCostTotals.cost : balance.monthlyCost;
  const monthlyTokens = monthlyTokenTotals.hasTokenData ? monthlyTokenTotals.tokens : balance.monthlyTokens;
  const monthlyRequests = monthlyTokenTotals.hasRequestData ? monthlyTokenTotals.requests : balance.monthlyRequests;

  return {
    date,
    balance: { value: balance.value, currency: balance.currency, toppedUp: balance.toppedUp, granted: balance.granted },
    todayTokens: hasTokens ? todayTokens : null,
    todayCost: hasCost ? todayCost : null,
    todayRequests: hasRequests ? todayRequests : null,
    cacheRate: totalHit + totalMiss > 0 ? totalHit / (totalHit + totalMiss) * 100 : null,
    models,
    account: {
      monthlyCost,
      cumulativeCost: balance.cumulativeCost,
      monthlyTokens,
      monthlyRequests
    },
    diagnostics: {
      source: 'platform-internal-api',
      selectedDate: date,
      amountDayCount: amountDays.length,
      costDayCount: costDays.length,
      modelNames: [...allModelNames],
      monthlyAggregation: {
        cost: monthlyCostTotals.hasCostData ? 'summed-days' : balance.monthlyCost != null ? 'summary' : 'missing',
        tokens: monthlyTokenTotals.hasTokenData ? 'summed-days' : balance.monthlyTokens != null ? 'summary' : 'missing',
        requests: monthlyTokenTotals.hasRequestData ? 'summed-days' : balance.monthlyRequests != null ? 'summary' : 'missing'
      }
    }
  };
}
