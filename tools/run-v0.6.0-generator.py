from pathlib import Path
import json

package = json.loads(Path('package.json').read_text(encoding='utf-8'))
if package.get('version') == '0.6.0':
    print('v0.6.0 sources already generated')
    raise SystemExit(0)

source_path = Path('tools/generate-v0.6.0.py')
source = source_path.read_text(encoding='utf-8')
marker = "\npipeline = subprocess.check_output"
if marker not in source:
    raise RuntimeError('generator pipeline boundary not found')
prefix = source.split(marker, 1)[0]
exec(compile(prefix, str(source_path), 'exec'), {'__name__': '__main__'})
Path('.maintenance-generated').write_text('v0.6.0\n', encoding='utf-8')
print('Generated product sources without modifying the workflow')
