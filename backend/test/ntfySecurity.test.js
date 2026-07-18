const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isBlockedAddress,
  validateNotificationUrl,
} = require('../src/services/ntfyService');

test('blocks loopback, link-local, unspecified, and multicast addresses', () => {
  for (const address of ['127.0.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'ff02::1']) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  assert.equal(isBlockedAddress('192.168.1.20'), false);
  assert.equal(isBlockedAddress('203.0.113.20'), false);
});

test('rejects blocked hostnames and DNS results', async () => {
  await assert.rejects(
    validateNotificationUrl('http://localhost:8080'),
    /hostname is blocked/,
  );
  await assert.rejects(
    validateNotificationUrl('https://notify.example', async () => [{ address: '169.254.169.254' }]),
    /blocked network address/,
  );
});

test('allows HTTP(S) servers resolving to public or private routable addresses', async () => {
  assert.equal(
    await validateNotificationUrl('https://ntfy.example/', async () => [{ address: '203.0.113.20' }]),
    'https://ntfy.example',
  );
  assert.equal(
    await validateNotificationUrl('http://ntfy.internal:8080', async () => [{ address: '192.168.1.20' }]),
    'http://ntfy.internal:8080',
  );
});