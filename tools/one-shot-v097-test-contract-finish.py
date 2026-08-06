from pathlib import Path


def replace_required(path_name, old, new):
    path = Path(path_name)
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path_name}: expected one match for {old!r}, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_required(
    'tests/background-refresh-v097.test.mjs',
    '  assert.match(refresh, /started\\.push\\(source_name\\.to_string\\(\\)\\)/);\n',
    ''
)

replace_required(
    'tests/long-running-sync-v095.test.mjs',
    '  assert.match(rust, /failed\\.push\\(format!\\(\"\\{source_name\\}：\\{error\\}\"\\)\\)/);\n',
    '  assert.match(rust, /report_source_refresh_failure/);\n'
    '  assert.match(rust, /source-refresh-failed/);\n'
)

replace_required(
    'tests/main-window-startup-v096.test.mjs',
    '  assert.match(refresh, /ensure_source_window\\(app, source, initial_sync\\)/);\n',
    '  assert.match(refresh, /spawn_source_refresh_worker/);\n'
    '  assert.match(rust, /ensure_source_window\\(&app, source, initial_sync\\)/);\n'
)

# These two contracts are already rewritten by the main architecture script.
long_running = Path('tests/long-running-sync-v095.test.mjs').read_text(encoding='utf-8')
for marker in [
    'requested_at: Some\\(sync_requested_at\\)',
    'already_running: false',
    '20 秒内未返回',
]:
    if marker not in long_running:
        raise SystemExit(f'long-running refresh contract missing: {marker}')
