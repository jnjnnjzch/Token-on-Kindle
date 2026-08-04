const hasChartData = option => Boolean(option && (Array.isArray(option.series) || option.dataset));

export function inspectReactEchartsFiber(rootFiber) {
  const seen = new Set();
  for (let fiber = rootFiber, depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
    for (const candidate of [fiber, fiber.alternate]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      const stateNode = candidate.stateNode;
      try {
        if (stateNode && typeof stateNode.getEchartsInstance === 'function') {
          const instance = stateNode.getEchartsInstance();
          const option = instance?.getOption?.();
          if (hasChartData(option)) return { option, method: 'react-component' };
        }
        if (stateNode?.echarts && typeof stateNode.echarts.getOption === 'function') {
          const option = stateNode.echarts.getOption();
          if (hasChartData(option)) return { option, method: 'react-state-node' };
        }
      } catch {
        // The chart class can exist before its ECharts instance finishes mounting.
      }
      for (const props of [candidate.memoizedProps, candidate.pendingProps, stateNode?.props]) {
        const option = props?.option;
        if (hasChartData(option)) return { option, method: 'react-props' };
      }
    }
  }
  return null;
}

export function readEchartsOptionFromElement(chart, echartsGlobal = null) {
  if (!chart) return null;
  try {
    const instance = echartsGlobal?.getInstanceByDom?.(chart);
    const option = instance?.getOption?.();
    if (hasChartData(option)) return { option, method: 'echarts-global' };
  } catch {
    // Ark bundles ECharts as a module, so a window-level instance is optional.
  }

  for (let node = chart, depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    for (const key of Object.getOwnPropertyNames(node)) {
      if (!/^__react(?:Fiber|InternalInstance|Container)\$.+/.test(key)) continue;
      const found = inspectReactEchartsFiber(node[key]);
      if (found) return found;
    }
  }
  return null;
}
