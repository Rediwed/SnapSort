const SECRET_SETTING_KEYS = new Set([
  'ntfy_auth_token',
  'ntfy_password',
]);

function publicSettings(settings) {
  const result = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SECRET_SETTING_KEYS.has(key)) {
      result[`${key}_configured`] = Boolean(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function normalizeSettingsUpdate(pairs) {
  const result = {};
  for (const [key, value] of Object.entries(pairs)) {
    if (key.endsWith('_configured')) continue;
    if (!SECRET_SETTING_KEYS.has(key)) {
      result[key] = value;
      continue;
    }

    if (value === null) {
      result[key] = '';
    } else if (typeof value === 'string' && value.length > 0) {
      result[key] = value;
    }
  }
  return result;
}

function publicSettingUpdate(key, storedValue) {
  if (SECRET_SETTING_KEYS.has(key)) {
    return { key, configured: Boolean(storedValue) };
  }
  return { key, value: String(storedValue) };
}

module.exports = {
  SECRET_SETTING_KEYS,
  normalizeSettingsUpdate,
  publicSettingUpdate,
  publicSettings,
};