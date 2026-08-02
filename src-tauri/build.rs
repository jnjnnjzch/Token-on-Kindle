use std::{env, fs, path::PathBuf};

const ICON_ICO: &[u8] = &[
    0x00,0x00,0x01,0x00,0x01,0x00,0x20,0x20,0x00,0x00,0x00,0x00,0x20,0x00,0xaf,0x00,
    0x00,0x00,0x16,0x00,0x00,0x00,0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,
    0x00,0x0d,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x20,0x00,0x00,0x00,0x20,0x08,0x06,
    0x00,0x00,0x00,0x73,0x7a,0x7a,0xf4,0x00,0x00,0x00,0x76,0x49,0x44,0x41,0x54,0x78,
    0x9c,0xed,0x97,0xc1,0x0e,0x80,0x20,0x0c,0x43,0x3b,0xb3,0xff,0xff,0xe5,0x7a,0x25,0x23,
    0x1a,0x35,0xb8,0x72,0x68,0x8f,0x5c,0xf6,0x28,0xdd,0x80,0x20,0x49,0x08,0x95,0x00,0x10,
    0x11,0x92,0xe2,0x24,0x71,0x48,0x2a,0x0f,0x92,0x03,0x64,0x5d,0xf8,0x3b,0x12,0xf5,0xb8,
    0xe5,0x0e,0x18,0x40,0x0e,0x30,0x85,0x70,0xd4,0xaa,0xf9,0x70,0x17,0xec,0xbd,0x1d,0x78,
    0xab,0xba,0xd3,0x27,0x0e,0xca,0x1d,0x30,0x80,0x01,0x0c,0x60,0x80,0xa5,0x93,0xf0,0xcb,
    0xdd,0xb1,0xb7,0x03,0x1d,0x2f,0x76,0xb9,0x03,0x06,0x90,0x03,0x4c,0x21,0xec,0xfe,0xa6,
    0xc9,0x1d,0x90,0x03,0x24,0xd0,0xd3,0xef,0x57,0x3a,0x01,0x7b,0x1c,0x16,0x4c,0xb7,0xc9,
    0x80,0x07,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82,
];

fn manifest_dir() -> PathBuf {
    PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
}

fn ensure_icons() {
    let icon_dir = manifest_dir().join("icons");
    fs::create_dir_all(&icon_dir).expect("create icons directory");
    let ico_path = icon_dir.join("icon.ico");
    if !ico_path.exists() {
        fs::write(ico_path, ICON_ICO).expect("write generated icon.ico");
    }
    let png_path = icon_dir.join("icon.png");
    if !png_path.exists() {
        fs::write(png_path, &ICON_ICO[22..]).expect("write generated icon.png");
    }
}

fn generate_version_module() {
    let version = env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION");
    let target = manifest_dir().join("../web/version.js");
    let content = format!(
        "// Generated from Cargo package metadata. Do not edit manually.\nexport const APP_VERSION = {:?};\n",
        version
    );
    fs::write(target, content).expect("write generated web/version.js");
}

fn browser_module(path: &PathBuf, export_name: &str, local_name: &str) -> String {
    fs::read_to_string(path)
        .unwrap_or_else(|_| panic!("read {}", path.display()))
        .replace(&format!("export function {export_name}"), &format!("function {local_name}"))
}

fn replace_between(source: &str, start: &str, end: &str, replacement: &str) -> String {
    let start_index = source.find(start).unwrap_or_else(|| panic!("missing extractor marker: {start}"));
    let end_relative = source[start_index..]
        .find(end)
        .unwrap_or_else(|| panic!("missing extractor marker: {end}"));
    let end_index = start_index + end_relative;
    format!("{}{}{}", &source[..start_index], replacement, &source[end_index..])
}

fn generate_extractor() {
    let manifest = manifest_dir();
    let generic_parser = browser_module(
        &manifest.join("../shared/deepseek-response-parser-v2.mjs"),
        "parseDeepSeekResponses",
        "parseDeepSeekResponses",
    );
    let summary_parser = browser_module(
        &manifest.join("../shared/deepseek-summary-parser.mjs"),
        "parseDeepSeekSummaryText",
        "parseDeepSeekSummaryText",
    );
    let platform_parser = browser_module(
        &manifest.join("../shared/deepseek-platform-parser.mjs"),
        "parseDeepSeekPlatformPayloads",
        "parseDeepSeekPlatformPayloads",
    );

    let base_path = manifest.join("../web/extractor-base.js");
    let target_path = manifest.join("../web/extractor.js");
    let mut base = fs::read_to_string(&base_path)
        .expect("read extractor base")
        .replace("\r\n", "\n");

    let old_summary_reads = r#"    const balance = cardMetric(['balance', '余额'], money);
    const rangeCost = cardMetric(['cost', '费用', '消耗'], money);
    const rangeTokens = cardMetric(['tokens', 'token'], numeric);
    const rangeRequests = cardMetric(['api requests', '请求'], numeric);"#;
    let new_summary_reads = r#"    let visibleSummary = {};
    for (let attempt = 0; attempt < 12; attempt += 1) {
      visibleSummary = window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__?.(document.body?.innerText || '') || {};
      if (visibleSummary.balance && visibleSummary.cost && visibleSummary.tokens && visibleSummary.requests) break;
      await sleep(400);
    }
    const previousSummary = window.__TOKEN_ON_KINDLE_LAST_SUMMARY__ || {};
    const balance = visibleSummary.balance || previousSummary.balance || cardMetric(['balance', '余额'], money);
    const rangeCost = visibleSummary.cost || previousSummary.cost || cardMetric(['cost', '费用', '消耗'], money);
    const rangeTokens = visibleSummary.tokens || previousSummary.tokens || cardMetric(['tokens', 'token'], numeric);
    const rangeRequests = visibleSummary.requests || previousSummary.requests || cardMetric(['api requests', '请求'], numeric);
    window.__TOKEN_ON_KINDLE_LAST_SUMMARY__ = { balance, cost: rangeCost, tokens: rangeTokens, requests: rangeRequests };"#;
    let replaced = base.replace(old_summary_reads, new_summary_reads);
    if replaced == base {
        panic!("DeepSeek summary injection point changed");
    }
    base = replaced;

    let direct_collect = r#"  function deepSeekPlatformToken() {
    const raw = localStorage.getItem('userToken');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : parsed?.value || parsed?.token || null;
    } catch {
      return raw;
    }
  }

  async function deepSeekPlatformJson(path, token) {
    const response = await fetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      credentials: 'include'
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  async function fetchDeepSeekPlatformUsage() {
    const token = deepSeekPlatformToken();
    if (!token) throw new Error('DeepSeek Platform 登录令牌不存在');
    const now = new Date();
    const periods = [
      { month: now.getMonth() + 1, year: now.getFullYear() },
      { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() }
    ].filter((item, index, all) => all.findIndex(other => other.month === item.month && other.year === item.year) === index);

    const summaryBody = await deepSeekPlatformJson('/api/v0/users/get_user_summary', token);
    const attempts = [];
    for (const period of periods) {
      try {
        const query = `month=${period.month}&year=${period.year}`;
        const [amountBody, costBody] = await Promise.all([
          deepSeekPlatformJson(`/api/v0/usage/amount?${query}`, token),
          deepSeekPlatformJson(`/api/v0/usage/cost?${query}`, token)
        ]);
        const parsed = window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_PLATFORM__({ summaryBody, amountBody, costBody, now });
        attempts.push(parsed);
      } catch (error) {
        attempts.push({ error: String(error?.message || error), date: null });
      }
    }
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const utcDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    const parsed = attempts.find(item => item?.date === localDate)
      || attempts.find(item => item?.date === utcDate)
      || attempts.filter(item => !item?.error).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!parsed) throw new Error(attempts.map(item => item.error).filter(Boolean).join(' | ') || 'DeepSeek 用量响应为空');
    parsed.diagnostics = { ...parsed.diagnostics, attempts: attempts.map(item => item.error ? { error: item.error } : { date: item.date }) };
    return parsed;
  }

  async function collectDeepSeek() {
    await sleep(350);
    let visibleSummary = {};
    for (let attempt = 0; attempt < 12; attempt += 1) {
      visibleSummary = window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__?.(document.body?.innerText || '') || {};
      if (visibleSummary.balance && visibleSummary.cost && visibleSummary.tokens && visibleSummary.requests) break;
      await sleep(400);
    }
    const previousSummary = window.__TOKEN_ON_KINDLE_LAST_SUMMARY__ || {};
    const balance = visibleSummary.balance || previousSummary.balance || cardMetric(['balance', '余额'], money);
    const rangeCost = visibleSummary.cost || previousSummary.cost || cardMetric(['cost', '费用', '消耗'], money);
    const rangeTokens = visibleSummary.tokens || previousSummary.tokens || cardMetric(['tokens', 'token'], numeric);
    const rangeRequests = visibleSummary.requests || previousSummary.requests || cardMetric(['api requests', '请求'], numeric);
    window.__TOKEN_ON_KINDLE_LAST_SUMMARY__ = { balance, cost: rangeCost, tokens: rangeTokens, requests: rangeRequests };

    let direct = null;
    let directError = null;
    try {
      direct = await fetchDeepSeekPlatformUsage();
    } catch (error) {
      directError = String(error?.message || error);
    }

    const networkResponses = [...(window.__TOKEN_ON_KINDLE_DEEPSEEK_RESPONSES__ || [])];
    const chart = echartsResponses();
    let fallback = null;
    let tooltips = [];
    if (!direct) {
      let combined = [...networkResponses, ...chart.responses];
      fallback = window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__?.(combined, new Date()) || null;
      const needsTooltip = !fallback || [fallback.models?.flash?.tokens, fallback.models?.pro?.tokens, fallback.models?.flash?.cost, fallback.models?.pro?.cost].some(value => value == null);
      if (needsTooltip) {
        tooltips = await hoverChartsForTooltips();
        combined = [...combined, ...tooltipResponses(tooltips)];
        fallback = window.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__?.(combined, new Date()) || fallback;
      }
    }

    const parsed = direct || fallback || {};
    const resolvedBalance = direct?.balance || (balance ? { value: balance.value, currency: 'CNY' } : null);
    return {
      source,
      capturedAt: new Date().toISOString(),
      updateIntervalMinutes: 10,
      url: location.href,
      balance: resolvedBalance,
      date: parsed.date || null,
      todayCost: parsed.todayCost == null ? null : { value: parsed.todayCost, currency: direct?.balance?.currency || 'CNY' },
      todayTokens: parsed.todayTokens == null ? null : { value: parsed.todayTokens },
      todayRequests: parsed.todayRequests == null ? null : { value: parsed.todayRequests },
      cacheRate: parsed.cacheRate == null ? null : { value: parsed.cacheRate },
      models: parsed.models || { flash: null, pro: null },
      account: direct?.account || null,
      range: {
        cost: rangeCost?.value ?? null,
        tokens: rangeTokens?.value ?? null,
        requests: rangeRequests?.value ?? null
      },
      diagnostics: {
        primarySource: direct ? 'platform-internal-api' : 'page-fallback',
        directError,
        captureInstalled: Boolean(window.__TOKEN_ON_KINDLE_CAPTURE_INSTALLED__),
        networkResponseCount: networkResponses.length,
        chartCount: chart.chartCount,
        tooltipCount: tooltips.length,
        parser: parsed.diagnostics || null,
        visibleSummary: visibleSummary.diagnostics || null
      }
    };
  }

"#;
    base = replace_between(
        &base,
        "  async function collectDeepSeek() {",
        "  let collecting = false;",
        direct_collect,
    );

    let generated = format!(
        "(() => {{\n{generic_parser}\nwindow.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__ = parseDeepSeekResponses;\n}})();\n\n(() => {{\n{summary_parser}\nwindow.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__ = parseDeepSeekSummaryText;\n}})();\n\n(() => {{\n{platform_parser}\nwindow.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_PLATFORM__ = parseDeepSeekPlatformPayloads;\n}})();\n\n{base}\n"
    );
    fs::write(target_path, generated).expect("write generated extractor");
}

fn main() {
    println!("cargo:rerun-if-changed=../web/extractor-base.js");
    println!("cargo:rerun-if-changed=../shared/deepseek-response-parser-v2.mjs");
    println!("cargo:rerun-if-changed=../shared/deepseek-summary-parser.mjs");
    println!("cargo:rerun-if-changed=../shared/deepseek-platform-parser.mjs");
    println!("cargo:rerun-if-changed=Cargo.toml");
    ensure_icons();
    generate_version_module();
    generate_extractor();
    tauri_build::build()
}
