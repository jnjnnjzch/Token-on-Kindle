from pathlib import Path

path = Path('tests/refresh-stability-v087.test.mjs')
text = path.read_text(encoding='utf-8')
text = text.replace("const worker = fs.readFileSync(new URL('../web/png-worker.js', import.meta.url), 'utf8');\n", '', 1)
old = '''test('PNG compression runs off the control-center thread', () => {
  assert.match(app, /new Worker\\(new URL\\('\\.\\/png-worker\\.js'/);
  assert.match(app, /let publishInFlight = null/);
  assert.match(app, /let publishQueued = false/);
  assert.match(app, /function schedulePublish/);
  assert.doesNotMatch(app, /requestAnimationFrame|publishDirty|publishPromise/);
  assert.match(worker, /encodeGrayscalePng/);
  assert.match(worker, /rgbaToGrayscale/);
  assert.match(worker, /postMessage\\(\\{ id, png: png\\.buffer \\}/);
});
'''
new = '''test('PNG generation uses the proven v0.6.2 direct encoder with single-flight publishing', () => {
  assert.doesNotMatch(app, /new Worker/);
  assert.match(app, /let publishInFlight = null/);
  assert.match(app, /let publishQueued = false/);
  assert.match(app, /function schedulePublish/);
  assert.match(app, /encodeGrayscalePng\\(profile\\.width, profile\\.height, rgbaToGrayscale\\(rgba\\)\\)/);
  assert.doesNotMatch(app, /requestAnimationFrame|publishDirty|publishPromise/);
});
'''
if text.count(old) != 1:
    raise SystemExit('refresh-stability-v087 worker test anchor changed')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
