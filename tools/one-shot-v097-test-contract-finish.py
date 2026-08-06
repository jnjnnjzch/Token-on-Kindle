from pathlib import Path


def update(path_name, replacements):
    path = Path(path_name)
    text = path.read_text(encoding='utf-8')
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise SystemExit(f'{path_name}: expected one match for {old!r}, found {count}')
        text = text.replace(old, new, 1)
    path.write_text(text, encoding='utf-8')


update('tests/background-refresh-v097.test.mjs', [
    (
        '  assert.match(refresh, /started\\.push\\(source_name\\.to_string\\(\\)\\)/);\n',
        ''
    ),
])

update('tests/long-running-sync-v095.test.mjs', [
    (
        '  assert.match(rust, /failed\\.push\\(format!\\(\"\\{source_name\\}：\\{error\\}\"\\)\\)/);\n',
        '  assert.match(rust, /report_source_refresh_failure/);\n'
        '  assert.match(rust, /source-refresh-failed/);\n'
    ),
    (
        '  assert.match(rust, /Ok\\(RefreshSummary \\{ refreshed, failed \\}\\)/);\n',
        '  assert.match(rust, /requested_at: Some\\(sync_requested_at\\)/);\n'
        '  assert.match(rust, /already_running: false/);\n'
    ),
    (
        '  assert.match(app, /已触发其余来源/);\n',
        '  assert.match(app, /失败：/);\n'
        '  assert.match(app, /source-refresh-failed/);\n'
    ),
])

update('tests/main-window-startup-v096.test.mjs', [
    (
        '  assert.match(refresh, /ensure_source_window\\(app, source, initial_sync\\)/);\n',
        '  assert.match(refresh, /spawn_source_refresh_worker/);\n'
        '  assert.match(rust, /ensure_source_window\\(&app, source, initial_sync\\)/);\n'
    ),
])
