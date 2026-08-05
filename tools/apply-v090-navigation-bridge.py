from pathlib import Path

root = Path(__file__).resolve().parents[1]
lib = root / "src-tauri/src/lib.rs"
text = lib.read_text()
text = text.replace(
    'const ACTION_PREFIX: &str = "__TOKEN_ON_KINDLE_ACTION__:";\n',
    'const ACTION_PREFIX: &str = "__TOKEN_ON_KINDLE_ACTION__:";\nconst NAVIGATION_BRIDGE_HOST: &str = "token-on-kindle.invalid";\n',
    1,
)

old_builder = '''    let parsed = url.parse().expect("static source URL must be valid");
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(1180.0, 820.0)
        .visible(false)
        .initialization_script(EXTRACTOR_SCRIPT)
        .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
        .build()?;'''
new_builder = '''    let parsed = url.parse().expect("static source URL must be valid");
    let app_handle = app.handle().clone();
    let bridge_label = label.to_string();
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(1180.0, 820.0)
        .visible(false)
        .initialization_script(EXTRACTOR_SCRIPT)
        .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
        .on_navigation(move |url| handle_navigation_bridge(&app_handle, &bridge_label, url))
        .build()?;'''
assert old_builder in text, "source window builder shape changed"
text = text.replace(old_builder, new_builder, 1)

start = text.index("fn handle_title_signal(window: &WebviewWindow, title: &str) {")
end = text.index("\nfn write_response(", start)
replacement = r'''fn store_metrics_signal(app: &AppHandle, source: &str, encoded: &str) -> Result<(), String> {
    let decoded = decode_base64_url(encoded)?;
    let payload = serde_json::from_slice::<Value>(&decoded)
        .map_err(|error| format!("采集数据 JSON 无效：{error}"))?;
    let state = app.state::<AppState>();
    let snapshot = {
        let mut metrics = state
            .metrics
            .lock()
            .map_err(|_| "采集状态锁已损坏".to_string())?;
        match source {
            "codex" => metrics.codex = Some(payload),
            "deepseek" => metrics.deepseek = Some(payload),
            "volcengine" => metrics.volcengine = Some(payload),
            _ => return Err(format!("未知采集来源：{source}")),
        }
        metrics.received_at = Some(timestamp());
        metrics.clone()
    };
    app.emit_to("main", "metrics-updated", snapshot)
        .map_err(|error| format!("无法通知主窗口：{error}"))?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn expected_source_for_label(label: &str) -> Option<&'static str> {
    match label {
        "codex-login" => Some("codex"),
        "deepseek-login" => Some("deepseek"),
        "volcengine-login" => Some("volcengine"),
        _ => None,
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn handle_navigation_bridge(app: &AppHandle, label: &str, url: &tauri::Url) -> bool {
    if url.scheme() != "https" || url.host_str() != Some(NAVIGATION_BRIDGE_HOST) {
        return true;
    }

    let segments = url
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();
    match segments.as_slice() {
        ["action", "dashboard"] => {
            if let Some(window) = app.get_webview_window(label) {
                return_to_dashboard(&window);
            }
        }
        ["signal", source, encoded] => {
            let expected = expected_source_for_label(label);
            if expected != Some(*source) {
                eprintln!(
                    "navigation bridge rejected source {source} from window {label}; expected {expected:?}"
                );
            } else if let Err(error) = store_metrics_signal(app, source, encoded) {
                eprintln!("navigation bridge rejected {source} payload: {error}");
            }
        }
        _ => eprintln!("navigation bridge rejected route: {}", url.path()),
    }
    false
}

fn handle_title_signal(window: &WebviewWindow, title: &str) {
    if let Some(action) = title.strip_prefix(ACTION_PREFIX) {
        if action == "dashboard" {
            return_to_dashboard(window);
        }
        return;
    }
    let Some(rest) = title.strip_prefix(SIGNAL_PREFIX) else {
        return;
    };
    let mut parts = rest.splitn(2, ':');
    let source = parts.next().unwrap_or_default();
    let encoded = parts.next().unwrap_or_default();
    let app = window.app_handle();
    if let Err(error) = store_metrics_signal(&app, source, encoded) {
        eprintln!("title bridge rejected {source} payload: {error}");
        return;
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let state = app.state::<AppState>();
        let active = state
            .mobile_refresh
            .lock()
            .map(|value| *value)
            .unwrap_or(false);
        if active {
            match source {
                "codex" => {
                    if let Ok(url) = DEEPSEEK_URL.parse() {
                        let _ = window.navigate(url);
                    }
                }
                "deepseek" => {
                    if let Ok(url) = VOLCENGINE_URL.parse() {
                        let _ = window.navigate(url);
                    }
                }
                "volcengine" => return_to_dashboard(window),
                _ => {}
            }
        }
    }
}
'''
text = text[:start] + replacement + text[end:]
lib.write_text(text)

compose = root / "tools/compose-extractor.mjs"
text = compose.read_text()
bridge_bootstrap = r'''  const BRIDGE_ORIGIN = 'https://token-on-kindle.invalid';
  let bridgeSequence = 0;
  window.__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__ = (kind, value, encoded = '') => {
    const path = kind === 'signal'
      ? `/signal/${encodeURIComponent(value)}/${encoded}`
      : `/action/${encodeURIComponent(value)}`;
    const url = `${BRIDGE_ORIGIN}${path}?nonce=${Date.now()}-${++bridgeSequence}`;
    try {
      location.assign(url);
      return true;
    } catch (error) {
      console.error('[Token on Kindle] navigation bridge failed', error);
      return false;
    }
  };
'''
marker = "  'use strict';\n  const defined = object =>"
assert marker in text, "signal compactor bootstrap changed"
text = text.replace(marker, "  'use strict';\n" + bridge_bootstrap + "  const defined = object =>", 1)

title_line = "    document.title = `__TOKEN_ON_KINDLE__:${source}:${encoded}`;\n"
assert title_line in text, "canonical title signal changed"
text = text.replace(
    title_line,
    title_line + "    window.__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__?.('signal', source, encoded);\n",
    1,
)
old_hide = "  hide.onclick = () => { document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard'; };"
new_hide = "  hide.onclick = () => {\n    document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard';\n    window.__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__?.('action', 'dashboard');\n  };"
assert old_hide in text, "source hide handler changed"
text = text.replace(old_hide, new_hide, 1)

deepseek_line = "    document.title = `__TOKEN_ON_KINDLE__:deepseek:${encodeSignal(payload)}`;"
deepseek_new = "    const encoded = encodeSignal(payload);\n    document.title = `__TOKEN_ON_KINDLE__:deepseek:${encoded}`;\n    window.__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__?.('signal', 'deepseek', encoded);"
deepseek_marker = "  .replace(\n    \"status('已同步余额、Flash/Pro Token 与缓存明细', 'success');\","
assert deepseek_marker in text, "DeepSeek reader replacement chain changed"
text = text.replace(
    deepseek_marker,
    "  .replace(\n    " + repr(deepseek_line) + ",\n    " + repr(deepseek_new) + "\n  )\n" + deepseek_marker,
    1,
)

volc_line = "    document.title = `__TOKEN_ON_KINDLE__:volcengine:${encodeSignal(payload)}`;"
volc_new = "    const encoded = encodeSignal(payload);\n    document.title = `__TOKEN_ON_KINDLE__:volcengine:${encoded}`;\n    window.__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__?.('signal', 'volcengine', encoded);"
volc_marker = "  .replace('`已同步 AFP 与 ${chart.models.length} 个模型`',"
assert volc_marker in text, "Volcengine reader replacement chain changed"
text = text.replace(
    volc_marker,
    "  .replace(\n    " + repr(volc_line) + ",\n    " + repr(volc_new) + "\n  )\n" + volc_marker,
    1,
)

assertion = "if (!output.includes('__TOKEN_ON_KINDLE_COMPACT_SIGNAL__')) throw new Error('compact signal transport missing');"
assert assertion in text, "output assertions changed"
text = text.replace(
    assertion,
    assertion + "\nif (!output.includes('__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__')) throw new Error('navigation bridge transport missing');\nif (!output.includes('token-on-kindle.invalid')) throw new Error('navigation bridge host missing');",
    1,
)
compose.write_text(text)

versions = {
    root / "package.json": ('"version": "0.8.9"', '"version": "0.9.0"'),
    root / "src-tauri/Cargo.toml": ('version = "0.8.9"', 'version = "0.9.0"'),
    root / "src-tauri/tauri.conf.json": ('"version": "0.8.9"', '"version": "0.9.0"'),
    root / "web/version.js": ('APP_VERSION = "0.8.9"', 'APP_VERSION = "0.9.0"'),
}
for path, (old, new) in versions.items():
    value = path.read_text()
    assert old in value, f"version marker missing in {path}"
    path.write_text(value.replace(old, new, 1))

test = root / "tests/navigation-bridge-v090.test.mjs"
test.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('source windows use a cancelled navigation as the primary native bridge', () => {
  assert.match(native, /NAVIGATION_BRIDGE_HOST: &str = "token-on-kindle\.invalid"/);
  assert.match(native, /\.on_navigation\(move \|url\| handle_navigation_bridge/);
  assert.match(native, /url\.host_str\(\) != Some\(NAVIGATION_BRIDGE_HOST\)/);
  assert.match(native, /\["signal", source, encoded\]/);
  assert.match(native, /\["action", "dashboard"\]/);
  assert.match(native, /false\n\}/);
});

test('generated extractor emits both navigation and title fallback signals', () => {
  assert.match(compose, /__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__/);
  assert.match(compose, /location\.assign\(url\)/);
  assert.match(extractor, /https:\/\/token-on-kindle\.invalid/);
  assert.match(extractor, /__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__\?\.\('signal', source, encoded\)/);
  assert.match(extractor, /__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__\?\.\('action', 'dashboard'\)/);
  assert.match(extractor, /__TOKEN_ON_KINDLE__:/);
});
''')

(root / ".github/workflows/apply-v090-navigation-bridge.yml").unlink(missing_ok=True)
Path(__file__).unlink(missing_ok=True)
