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
