from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'tests/update-helper-contract.test.mjs',
    "  assert.match(desktopRust, /tray_available\\.store\\(true/);\n",
    "  assert.match(desktopRust, /tray_available\\s*\\.store\\(true/);\n"
)

replace_once(
    'tests/volcengine-sticky-refresh-v094.test.mjs',
    '  assert.match(rust, /const VOLCENGINE_URL: &str = "https:\\/\\/console\\.volcengine\\.com\\/ark\\/region:cn-beijing\\/subscription\\/agent-plan-enterprise";/);\n',
    '  assert.match(rust, /const VOLCENGINE_URL: &str\\s*=\\s*"https:\\/\\/console\\.volcengine\\.com\\/ark\\/region:cn-beijing\\/subscription\\/agent-plan-enterprise";/);\n'
)
