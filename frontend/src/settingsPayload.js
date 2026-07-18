export const SECRET_SETTING_KEYS = [
  'ntfy_auth_token',
  'ntfy_password',
];

export function buildSettingsPayload(values) {
  const payload = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('_') || key.endsWith('_configured')) continue;
    if (!SECRET_SETTING_KEYS.includes(key)) {
      payload[key] = value;
      continue;
    }

    if (values[`_clear_${key}`]) {
      payload[key] = null;
    } else if (typeof value === 'string' && value.length > 0) {
      payload[key] = value;
    }
  }
  return payload;
}

export function updateSecretDraft(values, key, value) {
  return {
    ...values,
    [key]: value,
    [`_clear_${key}`]: false,
  };
}

export function clearSecretDraft(values, key) {
  return {
    ...values,
    [key]: '',
    [`_clear_${key}`]: true,
    [`${key}_configured`]: false,
  };
}