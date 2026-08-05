from pathlib import Path

root = Path(__file__).resolve().parents[1]

lib = root / "src-tauri/src/lib.rs"
text = lib.read_text()
assert 'const NAVIGATION_BRIDGE_HOST: &str = "token-on-kindle.invalid";\n' in text
text = text.replace('const NAVIGATION_BRIDGE_HOST: &str = "token-on-kindle.invalid";\n', '', 1)
text = text.replace('    let app_handle = app.handle().clone();\n    let bridge_label = label.to_string();\n', '', 1)
text = text.replace('        .on_navigation(move |url| handle_navigation_bridge(&app_handle, &bridge_label, url))\n', '', 1)
bridge_start = text.index('#[cfg(not(any(target_os = "android", target_os = "ios")))]\nfn expected_source_for_label')
bridge_end = text.index('fn handle_title_signal(window: &WebviewWindow, title: &str) {', bridge_start)
text = text[:bridge_start] + text[bridge_end:]
lib.write_text(text)

compose = root / "tools/compose-extractor.mjs"
text = compose.read_text()
bridge_start = text.index("  const BRIDGE_ORIGIN = 'https://token-on-kindle.invalid';")
bridge_end = text.index('  const defined = object =>', bridge_start)
text = text[:bridge_start] + text[bridge_end:]

canonical_signal_start = text.index('canonical = canonical.replace(\n  "document.title = `__TOKEN_ON_KINDLE__:${source}:${encoded}`;",')
canonical_hide_start = text.index("canonical = canonical.replace(\n  'hide.onclick = () => window.close();',", canonical_signal_start)
text = text[:canonical_signal_start] + text[canonical_hide_start:]

old_hide = '''canonical = canonical.replace(
  'hide.onclick = () => window.close();',
  "hide.onclick = () => {\\n    document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard';\\n    window.__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__?.('action', 'dashboard');\\n  };"
);'''
new_hide = '''canonical = canonical.replace(
  'hide.onclick = () => window.close();',
  "hide.onclick = () => { document.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard'; };"
);'''
assert old_hide in text
text = text.replace(old_hide, new_hide, 1)

text = text.replace(r"\n    window.__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__?.('signal', 'deepseek', encoded);", '', 1)
text = text.replace(r"\n    window.__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__?.('signal', 'volcengine', encoded);", '', 1)
text = text.replace("if (!output.includes('__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__')) throw new Error('navigation bridge transport missing');\n", '', 1)
text = text.replace("if (!output.includes('token-on-kindle.invalid')) throw new Error('navigation bridge host missing');\n", '', 1)
anchor = "if (!output.includes('__TOKEN_ON_KINDLE_COMPACT_SIGNAL__')) throw new Error('compact signal transport missing');\n"
assert anchor in text
text = text.replace(
    anchor,
    anchor
    + "if (!output.includes('document.title = `__TOKEN_ON_KINDLE__:${source}:${encoded}`')) throw new Error('title signal transport missing');\n"
    + "if (output.includes('__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__')) throw new Error('navigation bridge unexpectedly restored');\n"
    + "if (output.includes('token-on-kindle.invalid')) throw new Error('navigation bridge host unexpectedly restored');\n",
    1,
)
compose.write_text(text)

versions = {
    root / "package.json": ('"version": "0.9.0"', '"version": "0.9.1"'),
    root / "src-tauri/Cargo.toml": ('version = "0.9.0"', 'version = "0.9.1"'),
    root / "src-tauri/tauri.conf.json": ('"version": "0.9.0"', '"version": "0.9.1"'),
    root / "web/version.js": ('APP_VERSION = "0.9.0"', 'APP_VERSION = "0.9.1"'),
}
for path, (old, new) in versions.items():
    value = path.read_text()
    assert old in value, f"version marker missing in {path}"
    path.write_text(value.replace(old, new, 1))

(root / "tests/navigation-bridge-v090.test.mjs").unlink()
(root / "tests/title-bridge-v091.test.mjs").write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../tools/compose-extractor.mjs', import.meta.url), 'utf8');
const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');

test('desktop source windows use the proven v0.8.2 title bridge', () => {
  assert.match(native, /\.on_document_title_changed\(\|window, title\| handle_title_signal/);
  assert.match(native, /fn handle_title_signal\(window: &WebviewWindow, title: &str\)/);
  assert.match(native, /store_metrics_signal\(&app, source, encoded\)/);
  assert.doesNotMatch(native, /NAVIGATION_BRIDGE_HOST|\.on_navigation\(|handle_navigation_bridge/);
});

test('generated extractor never closes native source windows during refresh', () => {
  assert.match(compose, /background close-on-reload handler remains active/);
  assert.match(extractor, /document\.title = `__TOKEN_ON_KINDLE__:\$\{source\}:\$\{encoded\}`/);
  assert.match(extractor, /document\.title = '__TOKEN_ON_KINDLE_ACTION__:dashboard'/);
  assert.doesNotMatch(extractor, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(extractor, /hide\.onclick = \(\) => window\.close\(\)/);
  assert.doesNotMatch(extractor, /__TOKEN_ON_KINDLE_NAVIGATE_BRIDGE__|token-on-kindle\.invalid|location\.assign\(/);
});

test('compact payloads remain enabled on the title transport', () => {
  assert.match(extractor, /__TOKEN_ON_KINDLE_COMPACT_SIGNAL__/);
  assert.match(extractor, /const encoded = encodeSignal\(payload\)/);
  assert.match(extractor, /__TOKEN_ON_KINDLE__:deepseek:\$\{encoded\}/);
  assert.match(extractor, /__TOKEN_ON_KINDLE__:volcengine:\$\{encoded\}/);
});
''')

(root / ".github/workflows/apply-v091-title-bridge.yml").unlink(missing_ok=True)
Path(__file__).unlink(missing_ok=True)
