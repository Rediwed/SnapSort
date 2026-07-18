import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSettingsPayload,
  clearSecretDraft,
  updateSecretDraft,
} from '../src/settingsPayload.js';

test('omits configured metadata and untouched blank secrets', () => {
  assert.deepEqual(buildSettingsPayload({
    theme: 'dark',
    ntfy_auth_token: '',
    ntfy_auth_token_configured: true,
  }), { theme: 'dark' });
});

test('includes a newly typed secret', () => {
  assert.deepEqual(buildSettingsPayload({ ntfy_password: 'new-password' }), {
    ntfy_password: 'new-password',
  });
});

test('explicit secret clearing sends null', () => {
  const values = clearSecretDraft({ ntfy_password_configured: true }, 'ntfy_password');
  assert.deepEqual(buildSettingsPayload(values), { ntfy_password: null });
});

test('typing a replacement cancels pending clearing', () => {
  const cleared = clearSecretDraft({ ntfy_password_configured: true }, 'ntfy_password');
  const replacement = updateSecretDraft(cleared, 'ntfy_password', 'replacement');
  assert.deepEqual(buildSettingsPayload(replacement), { ntfy_password: 'replacement' });
});