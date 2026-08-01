from pathlib import Path

path = Path("src-tauri/src/lib.rs")
source = path.read_text(encoding="utf-8")

old = '''            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Token on Kindle")
                .inner_size(1080.0, 760.0)
                .min_inner_size(760.0, 580.0)
                .build()?;
'''

new = '''            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Token on Kindle")
                .inner_size(1080.0, 760.0)
                .min_inner_size(760.0, 580.0)
                .initialization_script(EXTRACTOR_SCRIPT)
                .on_document_title_changed(|window, title| handle_title_signal(&window, &title))
                .build()?;
'''

if old not in source:
    raise SystemExit("Main WebView builder block not found; refusing to patch")

path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Enabled extractor and title signal handling in the main mobile WebView")
