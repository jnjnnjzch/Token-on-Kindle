use std::{env, fs, path::PathBuf};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
}

fn verify_composed_extractor() {
    let manifest = manifest_dir();
    let extractor_path = manifest.join("../web/extractor.js");
    let extractor = fs::read_to_string(&extractor_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", extractor_path.display()));

    const REQUIRED: &[&str] = &[
        "TOKEN-ON-KINDLE v0.8.4 DIRECT CHART BUILD",
        "getEchartsInstance",
        "__TOKEN_ON_KINDLE_READ_ECHARTS_OPTION__",
        "__TOKEN_ON_KINDLE_PARSE_VOLCENGINE_ECHARTS__",
    ];
    for marker in REQUIRED {
        assert!(
            extractor.contains(marker),
            "web/extractor.js is not the composed v0.8.4 collector; missing {marker}"
        );
    }
    assert!(
        !extractor.contains("\n  installVolcengineNetworkCapture();"),
        "legacy Volcengine request interception is still active in the packaged extractor"
    );

    println!("cargo:rerun-if-changed=../web/extractor.js");
    println!("cargo:rerun-if-changed=../web/volcengine-chart-reader.js");
    println!("cargo:rerun-if-changed=../shared/volcengine-echarts-parser.mjs");
    println!("cargo:rerun-if-changed=../shared/volcengine-react-echarts-access.mjs");
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

fn main() {
    println!("cargo:rerun-if-changed=Cargo.toml");
    verify_composed_extractor();
    generate_version_module();
    tauri_build::build();
}
