const number = value => {
  const raw = typeof value === 'object' && value !== null ? value.value : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const defined = object => Object.fromEntries(
  Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
);

const modelSummary = model => model ? defined({
  name: model.name,
  requests: number(model.requests),
  tokens: number(model.tokens),
  cost: number(model.cost),
  cacheRate: number(model.cacheRate),
  cacheMissTokens: number(model.cacheMissTokens),
  cacheHitTokens: number(model.cacheHitTokens),
  outputTokens: number(model.outputTokens)
}) : undefined;

function compactDiagnostics(payload = {}) {
  const diagnostics = payload.diagnostics || {};
  const parser = diagnostics.parser || {};
  return defined({
    primarySource: diagnostics.primarySource,
    networkResponseCount: number(diagnostics.networkResponseCount),
    directError: diagnostics.directError,
    parser: Object.keys(parser).length ? defined({
      source: parser.source,
      selectedDate: parser.selectedDate,
      amountDayCount: number(parser.amountDayCount),
      costDayCount: number(parser.costDayCount),
      modelNames: Array.isArray(parser.modelNames) ? parser.modelNames : undefined
    }) : undefined
  });
}

function compactCodex(payload = {}) {
  return defined({
    source: payload.source,
    capturedAt: payload.capturedAt,
    account: payload.account ? defined({ plan: payload.account.plan, email: payload.account.email }) : undefined,
    quotas: Array.isArray(payload.quotas) ? payload.quotas.map(quota => defined({
      id: quota.id,
      label: quota.label,
      remainingPercent: number(quota.remainingPercent),
      usedPercent: number(quota.usedPercent),
      resetText: quota.resetText
    })) : undefined,
    diagnostics: compactDiagnostics(payload)
  });
}

function compactDeepSeek(payload = {}) {
  return defined({
    source: payload.source,
    capturedAt: payload.capturedAt,
    balance: number(payload.balance),
    today: defined({
      cost: number(payload.todayCost),
      requests: number(payload.todayRequests),
      tokens: number(payload.todayTokens)
    }),
    account: payload.account ? defined({
      cumulativeCost: number(payload.account.cumulativeCost),
      monthlyCost: number(payload.account.monthlyCost),
      monthlyRequests: number(payload.account.monthlyRequests),
      monthlyTokens: number(payload.account.monthlyTokens)
    }) : undefined,
    cacheRate: number(payload.cacheRate),
    models: payload.models ? defined({
      flash: modelSummary(payload.models.flash),
      pro: modelSummary(payload.models.pro)
    }) : undefined,
    diagnostics: compactDiagnostics(payload)
  });
}

export function diagnosticSnapshot(source, payload) {
  if (!payload) return null;
  return source === 'codex' ? compactCodex(payload) : compactDeepSeek(payload);
}
