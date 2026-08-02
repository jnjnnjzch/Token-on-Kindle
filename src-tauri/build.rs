use std::{env, fs, path::PathBuf};

// A compact 32×32 RGBA PNG wrapped in a single-image ICO container. Keeping the
// bytes in the build script makes clean checkouts buildable on every runner
// without committing binary font or icon assets through the text-only connector.
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

fn generate_extractor() {
    let manifest = manifest_dir();
    let parser_path = manifest.join("../shared/deepseek-response-parser-v2.mjs");
    let summary_path = manifest.join("../shared/deepseek-summary-parser.mjs");
    let base_path = manifest.join("../web/extractor-base.js");
    let target_path = manifest.join("../web/extractor.js");

    let parser = fs::read_to_string(&parser_path).expect("read DeepSeek response parser module");
    let parser = parser.replace(
        "export function parseDeepSeekResponses",
        "function parseDeepSeekResponses",
    );
    let summary = fs::read_to_string(&summary_path).expect("read DeepSeek summary parser module");
    let summary = summary.replace(
        "export function parseDeepSeekSummaryText",
        "function parseDeepSeekSummaryText",
    );

    let original_base = fs::read_to_string(&base_path).expect("read extractor base");
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
    let mut base = original_base.replace(old_summary_reads, new_summary_reads);
    if base == original_base {
        panic!("DeepSeek summary injection point changed; update build.rs instead of silently shipping a stale extractor");
    }

    let diagnostics_marker = "parser: parsed?.diagnostics || null";
    let diagnostics_replacement = "parser: parsed?.diagnostics || null,\n        visibleSummary: visibleSummary.diagnostics || null";
    base = base.replace(diagnostics_marker, diagnostics_replacement);

    let generated = format!(
        "(() => {{\n{parser}\nwindow.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK__ = parseDeepSeekResponses;\n}})();\n\n(() => {{\n{summary}\nwindow.__TOKEN_ON_KINDLE_PARSE_DEEPSEEK_SUMMARY__ = parseDeepSeekSummaryText;\n}})();\n\n{base}\n"
    );
    fs::write(target_path, generated).expect("write generated extractor");
}

fn main() {
    println!("cargo:rerun-if-changed=../web/extractor-base.js");
    println!("cargo:rerun-if-changed=../shared/deepseek-response-parser-v2.mjs");
    println!("cargo:rerun-if-changed=../shared/deepseek-summary-parser.mjs");
    println!("cargo:rerun-if-changed=Cargo.toml");
    ensure_icons();
    generate_version_module();
    generate_extractor();
    tauri_build::build()
}
