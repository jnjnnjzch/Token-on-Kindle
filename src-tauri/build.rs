fn main() {
    println!("cargo:rerun-if-changed=../web/extractor.js");
    tauri_build::build()
}
