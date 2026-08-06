from pathlib import Path

paths = [
    'tests/dynamic-layout-sync-v082.test.mjs',
    'tests/enterprise-flow-v080.test.mjs',
    'tests/long-running-sync-v095.test.mjs',
    'tests/volcengine-sticky-refresh-v094.test.mjs',
    'tests/windows-background-focus-v081.test.mjs',
]

replacements = {
    r'/\("codex-login", "Codex", true\)/': r'/\("codex", "Codex", true\)/',
    r'/\("deepseek-login", "DeepSeek", true\)/': r'/\("deepseek", "DeepSeek", true\)/',
    r'/\("volcengine-login", "火山方舟", false\)/': r'/\("volcengine", "火山方舟", false\)/',
}

for raw_path in paths:
    path = Path(raw_path)
    text = path.read_text(encoding='utf-8')
    changed = False
    for old, new in replacements.items():
        if old in text:
            text = text.replace(old, new)
            changed = True
    if not changed:
        raise SystemExit(f'{raw_path}: no stale refresh tuple assertions found')
    path.write_text(text, encoding='utf-8')

enterprise = Path('tests/enterprise-flow-v080.test.mjs')
text = enterprise.read_text(encoding='utf-8')
text = text.replace(
    "const tupleStart = refreshBlock.indexOf('(\"volcengine-login\", \"火山方舟\", false)');",
    "const tupleStart = refreshBlock.indexOf('(\"volcengine\", \"火山方舟\", false)');",
    1,
)
text = text.replace(
    r"assert.doesNotMatch(refreshBlock.slice(tupleStart), /\(\"volcengine-login\", \"火山方舟\", true\)/);",
    r"assert.doesNotMatch(refreshBlock.slice(tupleStart), /\(\"volcengine\", \"火山方舟\", true\)/);",
    1,
)
enterprise.write_text(text, encoding='utf-8')

long_running = Path('tests/long-running-sync-v095.test.mjs')
text = long_running.read_text(encoding='utf-8')
old = "  assert.match(rust, /typeof window\\.__TOKEN_ON_KINDLE_SYNC__ !== 'function'/);\n"
new = (
    "  assert.match(rust, /const deadline = Date\\.now\\(\\) \\+ 15000/);\n"
    "  assert.match(rust, /typeof window\\.__TOKEN_ON_KINDLE_SYNC__ === 'function'/);\n"
    "  assert.match(rust, /setTimeout\\(run, 250\\)/);\n"
)
if old not in text:
    raise SystemExit('long-running-sync-v095: stale immediate-failure assertion not found')
long_running.write_text(text.replace(old, new, 1), encoding='utf-8')
