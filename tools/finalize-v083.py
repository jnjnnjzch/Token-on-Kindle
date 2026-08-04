import json
import os
import subprocess
from pathlib import Path

BRANCH = 'agent/volcengine-model-token-v083'
ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

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
