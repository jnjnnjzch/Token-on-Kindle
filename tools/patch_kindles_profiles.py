from pathlib import Path

path = Path("src-tauri/src/lib.rs")
source = path.read_text(encoding="utf-8")

old = r'''fn validate_png(bytes: &[u8]) -> Result<(), String> {
    const SIG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 33 || &bytes[..8] != SIG {
        return Err("不是有效的 PNG 文件".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    let bit_depth = bytes[24];
    let color_type = bytes[25];
    if (width, height, bit_depth, color_type) != (600, 800, 8, 0) {
        return Err(format!(
            "需要 600×800、8 位灰度 PNG；实际为 {width}×{height}, bitDepth={bit_depth}, colorType={color_type}"
        ));
    }
    Ok(())
}

#[tauri::command]
fn set_dashboard_png(bytes: Vec<u8>, state: State<'_, AppState>) -> Result<(), String> {
    validate_png(&bytes)?;
    *state.png.write().map_err(|_| "PNG 锁已损坏")? = bytes;
    Ok(())
}
'''

new = r'''fn profile_dimensions(profile: &str) -> Option<(u32, u32)> {
    match profile {
        "kindle-600x800" => Some((600, 800)),
        "kindle-758x1024" => Some((758, 1024)),
        "kindle-1072x1448" => Some((1072, 1448)),
        "kindle-1080x1440" => Some((1080, 1440)),
        "kindle-1236x1648" => Some((1236, 1648)),
        "kindle-1264x1680" => Some((1264, 1680)),
        "kindle-1860x2480" => Some((1860, 2480)),
        _ => None,
    }
}

fn validate_png(bytes: &[u8], profile: &str) -> Result<(), String> {
    const SIG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 33 || &bytes[..8] != SIG {
        return Err("不是有效的 PNG 文件".into());
    }

    let (expected_width, expected_height) = profile_dimensions(profile)
        .ok_or_else(|| format!("不支持的 Kindle 屏幕配置：{profile}"))?;
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    let bit_depth = bytes[24];
    let color_type = bytes[25];

    if (width, height) != (expected_width, expected_height) {
        return Err(format!(
            "配置 {profile} 需要 {expected_width}×{expected_height}；实际为 {width}×{height}"
        ));
    }
    if (bit_depth, color_type) != (8, 0) {
        return Err(format!(
            "Kindle 图片必须是 8 位灰度 PNG；实际 bitDepth={bit_depth}, colorType={color_type}"
        ));
    }
    Ok(())
}

#[tauri::command]
fn set_dashboard_png(
    bytes: Vec<u8>,
    profile: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    validate_png(&bytes, &profile)?;
    *state.png.write().map_err(|_| "PNG 锁已损坏")? = bytes;
    Ok(())
}
'''

if old not in source:
    raise SystemExit("Target Rust block was not found; refusing to modify the file")

path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Patched src-tauri/src/lib.rs for native Kindle profiles")
