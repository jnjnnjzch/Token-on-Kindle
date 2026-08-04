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

const BASE_START: &str = "/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR START */";
const BASE_END: &str = "/* TOKEN-ON-KINDLE CANONICAL EXTRACTOR END */";
const GENERATED: &str = "/* TOKEN-ON-KINDLE DIRECT CHART BUILD */";

fn manifest_dir() -> PathBuf {
    PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
}

fn write_if_changed(path: &PathBuf, content: &[u8]) {
    if fs::read(path).ok().as_deref() == Some(content) {
        return;
    }
    fs::write(path, content).unwrap_or_else(|error| panic!("write {}: {error}", path.display()));
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

fn browser_module(path: &PathBuf, replacements: &[(&str, &str)]) -> String {
    let mut source = fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    for (from, to) in replacements {
        source = source.replace(from, to);
    }
    source
}

fn canonical_section(source: &str) -> String {
    if let (Some(start), Some(end)) = (source.find(BASE_START), source.find(BASE_END)) {
        return source[start + BASE_START.len()..end].trim().to_string();
    }
    source.trim().to_string()
}

fn stable_canonical(mut canonical: String) -> String {
    canonical = canonical.replace(
        "\n  installVolcengineNetworkCapture();",
        "\n  // Volcengine reads rendered ReactECharts state; request interception stays disabled.",
    );

    let Some(observer_start) = canonical.find("  let autoCapturedView = '';") else {
        assert!(
            !canonical.contains("new MutationObserver"),
            "canonical extractor observer shape changed"
        );
        return canonical;
    };
    let ready_relative = canonical[observer_start..]
        .find("\n\n  if (document.readyState === 'loading')")
        .expect("canonical extractor ready handler");
    let ready_handler = observer_start + ready_relative;
    let stable_start = r#"  function start() {
    toolbar();
    if (source !== 'volcengine') {
      setTimeout(() => collectAndSignal({ automatic: true }), 2500);
      setTimeout(() => collectAndSignal({ automatic: true }), 7000);
    } else {
      setToolbarStatus('等待企业版用量页面；轻量图表读取器将在页面就绪后同步');
    }
  }"#;
    format!(
        "{}{}{}",
        &canonical[..observer_start],
        stable_start,
        &canonical[ready_handler..]
    )
}

fn compose_extractor() {
    let manifest = manifest_dir();
    let extractor_path = manifest.join("../web/extractor.js");
    let current = fs::read_to_string(&extractor_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", extractor_path.display()));
    let canonical = stable_canonical(canonical_section(&current));
    let parser = browser_module(
        &manifest.join("../shared/volcengine-echarts-parser.mjs"),
        &[(
            "export function parseVolcengineEchartsOption",
            "function parseVolcengineEchartsOption",
        )],
    );
    let access = browser_module(
        &manifest.join("../shared/volcengine-react-echarts-access.mjs"),
        &[
            (
                "export function inspectReactEchartsFiber",
                "function inspectReactEchartsFiber",
            ),
            (
                "export function readEchartsOptionFromElement",
                "function readEchartsOptionFromElement",
            ),
        ],
    );
    let reader_path = manifest.join("../web/volcengine-chart-reader.js");
    let reader = fs::read_to_string(&reader_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", reader_path.display()));
    let modules = format!(
        r#"(() => {{
  if (!location.hostname.endsWith('volcengine.com')) return;
  window.__TOKEN_ON_KINDLE_VOLCENGINE_CAPTURE_INSTALLED__ = true;
{parser}
  window.__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__ = parseVolcengineEchartsOption;
{access}
  window.__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__ = readEchartsOptionFromElement;
}})();"#
    );
    let output = format!(
        "{GENERATED}\n{modules}\n{BASE_START}\n{canonical}\n{BASE_END}\n{reader}\n"
    );

    assert!(output.contains("getEchartsInstance"));
    assert!(output.contains("__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__"));
    assert!(output.contains("__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__"));
    assert!(!output.contains("\n  installVolcengineNetworkCapture();"));
    assert!(!output.contains("new MutationObserver"));
    write_if_changed(&extractor_path, output.as_bytes());
}

fn generate_version_module() {
    let version = env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION");
    let target = manifest_dir().join("../web/version.js");
    let content = format!(
        "// Generated from Cargo package metadata. Do not edit manually.\nexport const APP_VERSION = {:?};\n",
        version
    );
    write_if_changed(&target, content.as_bytes());
}

fn main() {
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=../web/extractor.js");
    println!("cargo:rerun-if-changed=../web/volcengine-chart-reader.js");
    println!("cargo:rerun-if-changed=../shared/volcengine-echarts-parser.mjs");
    println!("cargo:rerun-if-changed=../shared/volcengine-react-echarts-access.mjs");
    ensure_icons();
    compose_extractor();
    generate_version_module();
    tauri_build::build();
}
