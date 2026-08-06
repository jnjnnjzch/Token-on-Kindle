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

const volcengineModelSummary = model => model ? defined({
  id: model.id,
  name: model.name,
  totalTokens: number(model.totalTokens ?? model.tokens),
  latestTokens: number(model.latestTokens),
  peakTokens: number(model.peakTokens),
  pointCount: number(model.pointCount),
  inputTokens: number(model.inputTokens),
  outputTokens: number(model.outputTokens),
  cachedTokens: number(model.cachedTokens),
  requests: number(model.requests),
  afp: number(model.afp)
}) : undefined;

function compactDiagnostics(payload = {}) {
  const diagnostics = payload.diagnostics || {};
  const parser = diagnostics.parser || {};
  return defined({
    primarySource: diagnostics.primarySource,
    instruction: diagnostics.instruction,
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

function compactVolcengineDiagnostics(payload = {}) {
  const diagnostics = payload.diagnostics || {};
  const chart = diagnostics.modelChart || {};
  const parser = chart.parser || {};
  return defined({
    primarySource: diagnostics.primarySource,
    instruction: diagnostics.instruction,
    quotaCount: number(diagnostics.quotaCount),
    modelCount: number(diagnostics.modelCount),
    modelListCount: number(diagnostics.modelListCount),
    usageSeriesCount: number(diagnostics.usageSeriesCount),
    lifecycle: diagnostics.lifecycle,
    workerPage: diagnostics.workerPage,
    usageViewReady: diagnostics.usageViewReady,
    modelUsageSource: diagnostics.modelUsageSource,
    modelChart: Object.keys(chart).length ? defined({
      chartCount: number(chart.chartCount),
      chartInstanceId: chart.chartInstanceId,
      accessMethod: chart.accessMethod,
      legendNames: Array.isArray(chart.legendNames) ? chart.legendNames : undefined,
      periodStart: chart.periodStart,
      periodEnd: chart.periodEnd,
      granularity: chart.granularity,
      parser: Object.keys(parser).length ? defined({
        seriesCount: number(parser.seriesCount),
        datasetCount: number(parser.datasetCount),
        xAxisCount: number(parser.xAxisCount),
        pointCount: number(parser.pointCount),
        extractionMode: parser.extractionMode,
        legendNames: Array.isArray(parser.legendNames) ? parser.legendNames : undefined
      }) : undefined
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

function compactVolcengine(payload = {}) {
  return defined({
    source: payload.source,
    capturedAt: payload.capturedAt,
    plan: payload.plan,
    unit: payload.unit,
    windows: Array.isArray(payload.windows) ? payload.windows.map(item => defined({
      id: item.id,
      label: item.label,
      used: number(item.used),
      total: number(item.total),
      usedPercent: number(item.usedPercent),
      remainingPercent: number(item.remainingPercent),
      resetText: item.resetText,
      resetTime: number(item.resetTime),
      subscribeTime: number(item.subscribeTime)
    })) : undefined,
    models: Array.isArray(payload.models) ? payload.models.map(volcengineModelSummary).filter(Boolean) : undefined,
    modelUsage: payload.modelUsage ? defined({
      source: payload.modelUsage.source,
      periodStart: payload.modelUsage.periodStart,
      periodEnd: payload.modelUsage.periodEnd,
      granularity: payload.modelUsage.granularity
    }) : undefined,
    diagnostics: compactVolcengineDiagnostics(payload)
  });
}

export function diagnosticSnapshot(source, payload) {
  if (!payload) return null;
  if (source === 'codex') return compactCodex(payload);
  if (source === 'volcengine') return compactVolcengine(payload);
  return compactDeepSeek(payload);
}
