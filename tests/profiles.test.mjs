import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE_ID, KINDLE_PROFILES, getKindleProfile, isSupportedProfile } from '../web/profiles.js';
import { encodeGrayscalePng, verifyKindlePng } from '../shared/core.mjs';

test('Kindle profile ids and dimensions are unique and portrait-oriented', () => {
  const ids = new Set();
  const dimensions = new Set();
  for (const profile of KINDLE_PROFILES) {
    assert.ok(!ids.has(profile.id), `duplicate profile id: ${profile.id}`);
    ids.add(profile.id);
    assert.ok(Number.isInteger(profile.width) && profile.width > 0);
    assert.ok(Number.isInteger(profile.height) && profile.height > profile.width);
    const key = `${profile.width}x${profile.height}`;
    assert.ok(!dimensions.has(key), `duplicate dimensions: ${key}`);
    dimensions.add(key);
  }
});

test('unknown profiles fall back to classic 600x800', () => {
  assert.ok(isSupportedProfile(DEFAULT_PROFILE_ID));
  const profile = getKindleProfile('does-not-exist');
  assert.equal(profile.id, DEFAULT_PROFILE_ID);
  assert.deepEqual([profile.width, profile.height], [600, 800]);
});

test('the PNG encoder supports every native Kindle profile', () => {
  for (const profile of KINDLE_PROFILES) {
    const pixels = new Uint8Array(profile.width * profile.height).fill(255);
    const png = encodeGrayscalePng(profile.width, profile.height, pixels);
    const result = verifyKindlePng(png, profile.width, profile.height);
    assert.equal(result.ok, true, `${profile.id}: ${result.error}`);
    assert.equal(result.bitDepth, 8);
    assert.equal(result.colourType, 0);
  }
});
