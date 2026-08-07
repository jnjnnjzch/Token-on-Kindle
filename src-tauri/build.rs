use std::{env, fs, path::PathBuf, process::Command};

const ICON_ICO: &[u8] = &[
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x20, 0x20, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0xaf, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x20, 0x08, 0x06,
    0x00, 0x00, 0x00, 0x73, 0x7a, 0x7a, 0xf4, 0x00, 0x00, 0x00, 0x76, 0x49, 0x44, 0x41, 0x54, 0x78,
    0x9c, 0xed, 0x97, 0xc1, 0x0e, 0x80, 0x20, 0x0c, 0x43, 0x3b, 0xb3, 0xff, 0xff, 0xe5, 0x7a, 0x25,
    0x23, 0x1a, 0x35, 0xb8, 0x72, 0x68, 0x8f, 0x5c, 0xf6, 0x28, 0xdd, 0x80, 0x20, 0x49, 0x08, 0x95,
    0x00, 0x10, 0x11, 0x92, 0xe2, 0x24, 0x71, 0x48, 0x2a, 0x0f, 0x92, 0x03, 0x64, 0x5d, 0xf8, 0x3b,
    0x12, 0xf5, 0xb8, 0xe5, 0x0e, 0x18, 0x40, 0x0e, 0x30, 0x85, 0x70, 0xd4, 0xaa, 0xf9, 0x70, 0x17,
    0xec, 0xbd, 0x1d, 0x78, 0xab, 0xba, 0xd3, 0x27, 0x0e, 0xca, 0x1d, 0x30, 0x80, 0x01, 0x0c, 0x60,
    0x80, 0xa5, 0x93, 0xf0, 0xcb, 0xdd, 0xb1, 0xb7, 0x03, 0x1d, 0x2f, 0x76, 0xb9, 0x03, 0x06, 0x90,
    0x03, 0x4c, 0x21, 0xec, 0xfe, 0xa6, 0xc9, 0x1d, 0x90, 0x03, 0x24, 0xd0, 0xd3, 0xef, 0x57, 0x3a,
    0x01, 0x7b, 0x1c, 0x16, 0x4c, 0xb7, 0xc9, 0x80, 0x07, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
];

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
    let png = &ICON_ICO[22..];
    assert_eq!(
        &png[..8],
        b"\x89PNG\r\n\x1a\n",
        "generated icon PNG signature"
    );
    assert_eq!(&png[12..16], b"IHDR", "generated icon PNG IHDR");
    assert_eq!(png[28], 0, "generated icon PNG must be non-interlaced");
    assert!(
        png.ends_with(b"\x00\x00\x00\x00IEND\xaeB\x60\x82"),
        "generated icon PNG IEND"
    );
    write_if_changed(&icon_dir.join("icon.ico"), ICON_ICO);
    write_if_changed(&icon_dir.join("icon.png"), png);
}

fn compose_extractor() {
    let manifest = manifest_dir();
    let script = manifest.join("../tools/compose-extractor.mjs");
    let status = Command::new("node")
        .arg(&script)
        .current_dir(manifest.join(".."))
        .status()
        .unwrap_or_else(|error| panic!("run node {}: {error}", script.display()));
    assert!(
        status.success(),
        "extractor composition failed with {status}"
    );

    let target = manifest.join("../web/extractor.js");
    let output = fs::read_to_string(&target)
        .unwrap_or_else(|error| panic!("read {}: {error}", target.display()));
    for marker in [
        "TOKEN-ON-KINDLE DIRECT API WORKERS BUILD",
        "platform-internal-api",
        "GetAgentPlanSeatAFPUsage",
        "GetAgentPlanSeatUsageDetails",
        "v0.6.2-reload-worker",
    ] {
        assert!(
            output.contains(marker),
            "packaged extractor missing {marker}"
        );
    }
    assert!(
        !output.contains("new MutationObserver"),
        "continuous DOM observer remains active"
    );
    for marker in [
        "__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__",
        "__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__",
        "__TOKEN_ON_KINDLE_VOLCENGINE_RESPONSES__",
        "collectVolcengineWindow",
        "volcengineUsageReady",
        "volcengineModelsFromDom",
    ] {
        assert!(
            !output.contains(marker),
            "legacy Volcengine reader remains active: {marker}"
        );
    }
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
    for path in [
        "Cargo.toml",
        "../tools/compose-extractor.mjs",
        "../web/extractor-base.js",
        "../web/deepseek-direct-reader.js",
        "../web/volcengine-direct-reader.js",
        "../shared/deepseek-response-parser-v2.mjs",
        "../shared/deepseek-summary-parser.mjs",
        "../shared/deepseek-platform-parser.mjs",
        "../shared/volcengine-internal-api-parser.mjs",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
    ensure_icons();
    compose_extractor();
    generate_version_module();
    tauri_build::build();
}
