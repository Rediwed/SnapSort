'use strict';

/**
 * Backend unit tests for the security-critical validators.
 * Run with: node --test backend/test
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { validateBenchmarkRequest, validateBoundedInt } = require('../src/services/benchmarkValidator');
const { maskSecrets, isMaskedValue, isSecretKey, MASK } = require('../src/security');

test('validateBenchmarkRequest rejects a non-integer fileCount (RCE guard)', () => {
  assert.throws(() => validateBenchmarkRequest({
    sourcePath: '/a', destPath: '/b', fileCount: 'os.system("id")',
  }));
});

test('validateBenchmarkRequest rejects out-of-range fileSizeMB', () => {
  assert.throws(() => validateBenchmarkRequest({ sourcePath: '/a', destPath: '/b', fileSizeMB: 99999 }));
});

test('validateBenchmarkRequest applies safe defaults for valid input', () => {
  const r = validateBenchmarkRequest({ sourcePath: '/a', destPath: '/b' });
  assert.strictEqual(r.fileCount, 20);
  assert.strictEqual(r.fileSizeMB, 5);
  assert.strictEqual(r.repeats, 1);
});

test('validateBenchmarkRequest requires source and destination paths', () => {
  assert.throws(() => validateBenchmarkRequest({ destPath: '/b' }));
  assert.throws(() => validateBenchmarkRequest({ sourcePath: '/a' }));
});

test('validateBoundedInt enforces range and default', () => {
  assert.strictEqual(validateBoundedInt(undefined, 'fileCount'), 20);
  assert.throws(() => validateBoundedInt(0, 'fileCount'));
  assert.throws(() => validateBoundedInt(201, 'fileCount'));
  assert.strictEqual(validateBoundedInt(50, 'fileCount'), 50);
});

test('maskSecrets hides secret values but keeps non-secrets', () => {
  const masked = maskSecrets({
    ntfy_password: 'hunter2',
    ntfy_auth_token: '',
    immich_api_key: 'k',
    ntfy_topic: 'snap',
  });
  assert.strictEqual(masked.ntfy_password, MASK);
  assert.strictEqual(masked.ntfy_auth_token, ''); // empty secret stays empty
  assert.strictEqual(masked.immich_api_key, MASK);
  assert.strictEqual(masked.ntfy_topic, 'snap');
});

test('isSecretKey classifies keys correctly', () => {
  assert.ok(isSecretKey('ntfy_password'));
  assert.ok(isSecretKey('immich_api_key'));
  assert.ok(isSecretKey('some_token'));
  assert.ok(!isSecretKey('ntfy_topic'));
});

test('isMaskedValue recognizes only the sentinel', () => {
  assert.ok(isMaskedValue(MASK));
  assert.ok(!isMaskedValue('real-value'));
  assert.ok(!isMaskedValue(''));
});
