const test = require('node:test');
const assert = require('node:assert/strict');
const { boundedInteger, idArray } = require('../src/security/validation');
const { validateSettingsUpdate } = require('../src/security/settingsPolicy');
const { validateProfile } = require('../src/security/profilePolicy');

test('bounded integers reject NaN, fractions, and excessive values', () => {
  assert.throws(() => boundedInteger('NaN', 'limit', { minimum: 0, maximum: 100 }), /integer/);
  assert.throws(() => boundedInteger('1.5', 'limit', { minimum: 0, maximum: 100 }), /integer/);
  assert.throws(() => boundedInteger('101', 'limit', { minimum: 0, maximum: 100 }), /between/);
  assert.equal(boundedInteger('50', 'limit', { minimum: 0, maximum: 100 }), 50);
});

test('ID arrays are bounded, unique, and string-only', () => {
  assert.deepEqual(idArray(['a', 'a', 'b'], 'ids'), ['a', 'b']);
  assert.throws(() => idArray(Array(501).fill('a'), 'ids'), /at most 500/);
  assert.throws(() => idArray([42], 'ids'), /string/);
});

test('settings reject unknown keys and unsafe values', () => {
  assert.throws(() => validateSettingsUpdate({ arbitrary: 'value' }), /Unknown setting/);
  assert.throws(() => validateSettingsUpdate({ max_worker_threads: '1000' }), /between/);
  assert.throws(() => validateSettingsUpdate({ ntfy_server: 'file:///etc/passwd' }), /HTTP/);
  assert.deepEqual(validateSettingsUpdate({ theme: 'light', concurrent_copies: '4' }), {
    theme: 'light', concurrent_copies: '4',
  });
});

test('profiles reject unknown and unbounded fields', () => {
  assert.throws(() => validateProfile({ name: 'x', arbitrary: true }), /Unknown profile/);
  assert.throws(() => validateProfile({ name: 'x', max_workers: 1000 }), /between/);
  assert.equal(validateProfile({ name: 'Safe' }).max_workers, 4);
});