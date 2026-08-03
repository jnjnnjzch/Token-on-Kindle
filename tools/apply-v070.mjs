import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const write = (relative, content) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) fs.writeFileSync(target, content);
};
const replaceRequired = (text, search, replacement, label) => {
  if (text.includes(replacement)) return text;
  if (!text.includes(search)) throw new Error(`v0.7.0 patch target missing: ${label}`);
  return text.replace(search, replacement);
};

const payloadFiles = {
  "web/index.html": "tools/v070-payload/web__index.html.b64",
  "web/app.js": "tools/v070-payload/web__app.js.b64",
  "web/diagnostics.js": "tools/v070-payload/web__diagnostics.js.b64",
  "web/kindle-renderer.js": "tools/v070-payload/web__kindle-renderer.js.b64",
  "tests/volcengine-contract.test.mjs": "tools/v070-payload/tests__volcengine-contract.test.mjs.b64",
  "tests/display-selection.test.mjs": "tools/v070-payload/tests__display-selection.test.mjs.b64"
};
for (const [relative, payloadPath] of Object.entries(payloadFiles)) {
  write(relative, Buffer.from(read(payloadPath).trim(), 'base64').toString('utf8'));
}

const VERSION = '0.7.0';
let cargo = read('src-tauri/Cargo.toml');
cargo = cargo.replace(/(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${VERSION}$2`);
write('src-tauri/Cargo.toml', cargo);

const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
tauri.version = VERSION;
write('src-tauri/tauri.conf.json', `${JSON.stringify(tauri, null, 2)}\n`);
write('web/version.js', `// Generated from the release tag / Cargo package version. Do not edit manually.\nexport const APP_VERSION = "${VERSION}";\n`);
write('tests/version-target.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\n\nconst pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));\n\ntest('Volcengine AFP and display controls release targets v0.7.0', () => {\n  assert.equal(pkg.version, '0.7.0');\n});\n`);

let native = read('src-tauri/src/lib.rs');
native = replaceRequired(
  native,
  'const DEEPSEEK_URL: &str = "https://platform.deepseek.com/usage";',
  'const DEEPSEEK_URL: &str = "https://platform.deepseek.com/usage";\nconst VOLCENGINE_URL: &str = "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan-enterprise";',
  'Volcengine URL'
);
native = replaceRequired(
  native,
  '    deepseek: Option<Value>,\n    received_at: Option<String>,',
  '    deepseek: Option<Value>,\n    volcengine: Option<Value>,\n    received_at: Option<String>,',
  'metrics state'
);
native = replaceRequired(
  native,
  '        "deepseek" => Ok(("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL)),\n        _ => Err("未知数据源".into()),',
  '        "deepseek" => Ok(("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL)),\n        "volcengine" => Ok(("volcengine-login", "火山方舟 Agent Plan", VOLCENGINE_URL)),\n        _ => Err("未知数据源".into()),',
  'source URL mapping'
);
native = replaceRequired(
  native,
  '        "deepseek" => ("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL),\n        _ => unreachable!("only static sources are created"),',
  '        "deepseek" => ("deepseek-login", "DeepSeek Platform", DEEPSEEK_URL),\n        "volcengine" => ("volcengine-login", "火山方舟 Agent Plan", VOLCENGINE_URL),\n        _ => unreachable!("only static sources are created"),',
  'source window mapping'
);
native = replaceRequired(
  native,
  '    for label in ["codex-login", "deepseek-login"] {',
  '    for label in ["codex-login", "deepseek-login", "volcengine-login"] {',
  'source reload list'
);
native = replaceRequired(
  native,
  '            "deepseek" => metrics.deepseek = Some(payload),\n            _ => return,',
  '            "deepseek" => metrics.deepseek = Some(payload),\n            "volcengine" => metrics.volcengine = Some(payload),\n            _ => return,',
  'signal state update'
);
native = replaceRequired(
  native,
  '                "deepseek" => return_to_dashboard(window),\n                _ => {}',
  '                "deepseek" => {\n                    if let Ok(url) = VOLCENGINE_URL.parse() {\n                        let _ = window.navigate(url);\n                    }\n                }\n                "volcengine" => return_to_dashboard(window),\n                _ => {}',
  'mobile refresh chain'
);
native = replaceRequired(
  native,
  '                create_source_window(app, "deepseek")?;\n            }',
  '                create_source_window(app, "deepseek")?;\n                create_source_window(app, "volcengine")?;\n            }',
  'Volcengine source setup'
);
native = native.replaceAll('Codex 与 DeepSeek 用量看板', 'Codex、DeepSeek 与火山方舟用量看板');
write('src-tauri/src/lib.rs', native);

let extractor = read('web/extractor.js');
extractor = replaceRequired(
  extractor,
  "  const source = host === 'chatgpt.com' ? 'codex' : host.endsWith('deepseek.com') ? 'deepseek' : null;",
  "  const source = host === 'chatgpt.com' ? 'codex' : host.endsWith('deepseek.com') ? 'deepseek' : host.endsWith('volcengine.com') ? 'volcengine' : null;",
  'extractor host mapping'
);
extractor = replaceRequired(
  extractor,
  "      document.title = pageTitle || (source === 'codex' ? 'Codex Analytics' : 'DeepSeek Platform');",
  "      document.title = pageTitle || ({ codex: 'Codex Analytics', deepseek: 'DeepSeek Platform', volcengine: '火山方舟 Agent Plan' }[source] || 'Token on Kindle');",
  'extractor title fallback'
);
const volcCollector = String.raw`
  function volcAmount(value) {
    const text = clean(value).replaceAll(',', '');
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed * (/万/.test(text) ? 10000 : 1) : null;
  }

  function exactVolcLabel(labels) {
    const wanted = labels.map(label => clean(label));
    return [...document.querySelectorAll('span,div,p,label,h1,h2,h3,h4')]
      .find(element => wanted.includes(clean(element.textContent)));
  }

  function collectVolcWindow(id, label, labels) {
    const anchor = exactVolcLabel(labels);
    if (!anchor) return null;
    let node = anchor;
    let root = anchor.parentElement;
    for (let depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent || '');
      if (text.includes(label) && /已使用/.test(text) && /重置/.test(text) && text.length < 700) {
        root = node;
        break;
      }
    }
    const text = clean(root?.innerText || root?.textContent || '');
    const titled = [...(root?.querySelectorAll?.('[title]') || [])]
      .map(element => volcAmount(element.getAttribute('title')))
      .filter(value => value != null);
    const fraction = text.match(/([\d,.]+)\s*\/\s*([\d,.]+\s*万?)/);
    const used = titled[0] ?? volcAmount(fraction?.[1]);
    const total = titled.find((value, index) => index > 0 && (used == null || value >= used))
      ?? volcAmount(fraction?.[2]);
    const progress = root?.querySelector?.('[aria-valuenow]');
    const usedPercent = number(progress?.getAttribute('aria-valuenow'))
      ?? number(text.match(/已使用\s*(\d+(?:\.\d+)?)\s*%/)?.[1]);
    const reset = text.match(/((?:\d+天)?(?:\d+小时)?(?:\d+分钟)?后重置)/)?.[1] || null;
    if (used == null && total == null && usedPercent == null) return null;
    return { id, label, used, total, usedPercent, resetText: reset };
  }

  function collectVolcengine() {
    const windows = [
      collectVolcWindow('5h', '近5小时用量', ['近5小时用量']),
      collectVolcWindow('weekly', '近一周用量', ['近一周用量']),
      collectVolcWindow('monthly', '近一月用量', ['近一月用量'])
    ].filter(Boolean);
    return {
      source,
      capturedAt: new Date().toISOString(),
      updateIntervalMinutes: 10,
      plan: 'Agent Plan Enterprise',
      unit: 'AFP',
      windows,
      url: location.href,
      diagnostics: { primarySource: 'semantic-dom', windowCount: windows.length }
    };
  }

`;
if (!extractor.includes('function collectVolcengine()')) {
  extractor = extractor.replace('  let collecting = false;', `${volcCollector}  let collecting = false;`);
}
extractor = replaceRequired(
  extractor,
  "      const payload = source === 'codex' ? collectCodex() : await collectDeepSeek();",
  "      const payload = source === 'codex' ? collectCodex() : source === 'volcengine' ? collectVolcengine() : await collectDeepSeek();",
  'collector dispatch'
);
write('web/extractor.js', extractor);

let styles = read('web/styles.css');
const css = Buffer.from(`Ci8qIHYwLjcuMCDCtyBWb2xjZW5naW5lIGFuZCBzZWxlY3RhYmxlIGRhc2hib2FyZCBjb250ZW50ICovCi5zb3VyY2Utc3RyaXB7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOm1pbm1heCgyMTVweCwxZnIpIG1pbm1heCgyMTVweCwxZnIpIG1pbm1heCgyMTVweCwxZnIpIDE1OHB4fQouZGlzcGxheS1wYW5lbHtwYWRkaW5nOjE3cHh9Ci5kaXNwbGF5LWhlbHB7bWFyZ2luLXRvcDo5cHh9Ci5kaXNwbGF5LW9wdGlvbnN7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyO2dhcDo4cHg7bWFyZ2luLXRvcDoxMnB4fQouZGlzcGxheS1vcHRpb257cG9zaXRpb246cmVsYXRpdmU7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoyMHB4IG1pbm1heCgwLDFmcikgMThweDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjlweDtwYWRkaW5nOjEwcHg7Ym9yZGVyOjFweCBzb2xpZCAjZDRkNGNkO2JvcmRlci1yYWRpdXM6MTFweDtiYWNrZ3JvdW5kOiNmYWZhZjc7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjouMTRzIGVhc2V9Ci5kaXNwbGF5LW9wdGlvbjpob3Zlcntib3JkZXItY29sb3I6IzlmOWY5ODt0cmFuc2Zvcm06dHJhbnNsYXRlWSgtMXB4KX0KLmRpc3BsYXktb3B0aW9uIGlucHV0e3Bvc2l0aW9uOmFic29sdXRlO29wYWNpdHk6MDtwb2ludGVyLWV2ZW50czpub25lfQouZGlzcGxheS1vcHRpb24tY29weXtkaXNwbGF5OmZsZXg7bWluLXdpZHRoOjA7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoycHh9Ci5kaXNwbGF5LW9wdGlvbi1jb3B5IHN0cm9uZ3tmb250LXNpemU6MTJweH0KLmRpc3BsYXktb3B0aW9uLWNvcHkgc21hbGx7b3ZlcmZsb3c6aGlkZGVuO2NvbG9yOiM3NDc0NmQ7Zm9udC1zaXplOjlweDt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcH0KLmRpc3BsYXktb3B0aW9uOmhhcyhpbnB1dDpjaGVja2VkKXtib3JkZXItY29sb3I6IzYyNjI1YztiYWNrZ3JvdW5kOiNmMGYwZWI7Ym94LXNoYWRvdzppbnNldCAzcHggMCAwICMxODE4MTh9Ci5kaXNwbGF5LWNoZWNre2Rpc3BsYXk6Z3JpZDtwbGFjZS1pdGVtczpjZW50ZXI7d2lkdGg6MThweDtoZWlnaHQ6MThweDtib3JkZXI6MXB4IHNvbGlkICNiN2I3YjA7Ym9yZGVyLXJhZGl1czo1cHg7Y29sb3I6dHJhbnNwYXJlbnQ7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6OTAwfQouZGlzcGxheS1vcHRpb246aGFzKGlucHV0OmNoZWNrZWQpIC5kaXNwbGF5LWNoZWNre2JvcmRlci1jb2xvcjojMTgxODE4O2JhY2tncm91bmQ6IzE4MTgxODtjb2xvcjojZmZmfQouc3RhdHVzLWdyaWR7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmcn0KQG1lZGlhKG1heC13aWR0aDoxMTgwcHgpey5zb3VyY2Utc3RyaXB7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmciAxZnJ9LnJlZnJlc2gtYnV0dG9ue21pbi1oZWlnaHQ6NjhweH19CkBtZWRpYShtYXgtd2lkdGg6OTAwcHgpey5kaXNwbGF5LW9wdGlvbnN7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmcn19CkBtZWRpYShtYXgtd2lkdGg6NjgwcHgpey5zb3VyY2Utc3RyaXB7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmcn19Cg==`, 'base64').toString('utf8');
if (!styles.includes('v0.7.0 · Volcengine')) styles += css;
write('web/styles.css', styles);

let readme = read('README.md');
if (!readme.includes('## v0.7.0')) {
  readme = readme.replace(
    '# Token on Kindle\n\n',
    '# Token on Kindle\n\n'
  ).replace(
    '## v0.6.2',
    '## v0.7.0\n\n- 新增火山方舟 Agent Plan Enterprise 的 AFP 用量采集，显示近 5 小时、近一周、近一月的已用量、总额、百分比与重置倒计时。\n- 新增“显示内容”选择器，可独立控制 Codex、DeepSeek 总览、V4 Flash、V4 Pro 与火山方舟 AFP。\n- 选择结果同时作用于桌面预览、Kindle 浏览器页面和屏保 PNG，并保存在本机。\n- 火山方舟采集使用中文语义标签、title 数值和 aria-valuenow，不依赖易变化的哈希类名。\n\n## v0.6.2'
  );
}
readme = readme.replace('Codex Analytics 与 DeepSeek Platform', 'Codex Analytics、DeepSeek Platform 与火山方舟 Agent Plan');
write('README.md', readme);

console.log('Applied Token on Kindle v0.7.0 source generation.');
