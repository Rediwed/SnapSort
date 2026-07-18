const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSettingsUpdate,
  publicSettingUpdate,
  publicSettings,
} = require('../src/security/settingsSecrets');

test('public settings never include stored secret values', () => {
  assert.deepEqual(publicSettings({
    theme: 'dark',
    ntfy_auth_token: 'token-value',
    ntfy_password: 'password-value',
  }), {
    theme: 'dark',
    ntfy_auth_token_configured: true,
    ntfy_password_configured: true,
  });
});

test('blank secret fields preserve existing values by omission', () => {
  assert.deepEqual(normalizeSettingsUpdate({
    theme: 'light',
    ntfy_auth_token: '',
    ntfy_password: '',
  }), { theme: 'light' });
});

test('non-empty secrets are accepted for write-only updates', () => {
  assert.deepEqual(normalizeSettingsUpdate({ ntfy_auth_token: 'new-token' }), {
    ntfy_auth_token: 'new-token',
  });
});

test('null explicitly clears a stored secret', () => {
  assert.deepEqual(normalizeSettingsUpdate({ ntfy_password: null }), {
    ntfy_password: '',
  });
});

test('configured metadata cannot be written back as a setting', () => {
  assert.deepEqual(normalizeSettingsUpdate({ ntfy_password_configured: true }), {});
});

test('single secret updates never echo their value', () => {
  assert.deepEqual(publicSettingUpdate('ntfy_password', 'new-password'), {
    key: 'ntfy_password',
    configured: true,
  });
});