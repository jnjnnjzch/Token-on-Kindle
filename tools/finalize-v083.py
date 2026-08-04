import json
import os
import subprocess
from pathlib import Path

BRANCH = 'agent/volcengine-model-token-v083'
ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

# Keep the established three-source minimums: the Volcengine model grid must
# adapt inside its compact card rather than taking space away from DeepSeek.
renderer_path = Path('web/kindle-renderer.js')
renderer = renderer_path.read_text(encoding='utf-8').replace(
    "  return sources.map(source => ({ codex: 122, deepseek: 272, volcengine: 170 })[source]);",
    "  return sources.map(source => ({ codex: 132, deepseek: 294, volcengine: 138 })[source]);"
)
renderer_path.write_text(renderer, encoding='utf-8')

test_path = Path('tests/volcengine-model-usage-v083.test.mjs')
test_source = test_path.read_text(encoding='utf-8')
test_source = test_source.replace(
    "test('three-source layout gives Volcengine room for quota strip and model grid', () => {",
    "test('three-source compact Volcengine card adapts without shrinking DeepSeek', () => {"
).replace(
    "  assert.deepEqual(boxes.map(box => box.height), [122, 272, 170]);",
    "  assert.deepEqual(boxes.map(box => box.height), [132, 294, 138]);\n  const compact = volcengineModelLayoutPlan(138, 8);\n  assert.equal(compact.columns, 2);\n  assert.ok(compact.overflowCount > 0);"
)
test_path.write_text(test_source, encoding='utf-8')

package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
package['version'] = '0.8.3'
package['scripts']['test'] = 'node tools/check-version-sync.mjs && node --test tests/*.test.mjs && node --check web/app.js && node --check web/kindle-renderer.js && node --check web/extractor-base.js && node --check web/extractor.js && node --check web/diagnostics.js && node --check shared/deepseek-response-parser-v2.mjs && node --check shared/volcengine-response-parser.mjs && node --check shared/deepseek-summary-parser.mjs && node --check shared/deepseek-platform-parser.mjs && node --check web/update.js && node --check tools/sync-version.mjs && node --check web/desktop.js'
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

Path('tools/materialize-v083.py').unlink(missing_ok=True)
Path('tools/finalize-v083.py').unlink(missing_ok=True)
subprocess.run(['npm', 'test'], check=True)

if os.environ.get('GITHUB_ACTIONS') == 'true':
    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
    subprocess.run(['git', 'add', '-A'], check=True)
    result = subprocess.run(['git', 'diff', '--cached', '--quiet'])
    if result.returncode != 0:
        subprocess.run(['git', 'commit', '-m', 'v0.8.3: capture and adapt Volcengine model tokens'], check=True)
        subprocess.run(['git', 'push', 'origin', f'HEAD:{BRANCH}'], check=True)
