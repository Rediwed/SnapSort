const { ValidationError, boundedInteger, boundedString, enumValue, plainObject } = require('./validation');

const BOOLEAN_KEYS = new Set([
  'enable_fast_hash', 'enable_multithreading', 'sequential_processing',
  'ntfy_enabled', 'ntfy_on_job_start', 'ntfy_on_job_complete',
  'ntfy_on_job_error', 'ntfy_on_progress', 'ntfy_on_drive_scan',
  'ntfy_on_drive_attach', 'ntfy_on_drive_lost', 'browser_notify_enabled',
  'diagnostics_enabled',
]);

const INTEGER_RANGES = {
  min_width: [0, 100000],
  min_height: [0, 100000],
  min_filesize: [0, 1024 * 1024 * 1024 * 1024],
  dedup_strict_threshold: [0, 100],
  dedup_log_threshold: [0, 100],
  fast_hash_bytes: [512, 1024 * 1024],
  max_worker_threads: [1, 64],
  parallel_hash_workers: [1, 64],
  batch_size: [1, 1000],
  hash_bytes: [512, 1024 * 1024],
  concurrent_copies: [1, 32],
  ntfy_progress_interval: [10, 86400],
};

const ENUM_KEYS = {
  ntfy_auth_type: ['none', 'token', 'basic'],
  date_format: ['system', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
  time_format: ['system', '12h', '24h'],
  theme: ['dark', 'light', 'system'],
};

const STRING_LIMITS = {
  default_performance_profile: 100,
  ntfy_topic: 255,
  ntfy_username: 255,
  ntfy_auth_token: 4096,
  ntfy_password: 4096,
  hidden_drives: 10000,
};

function validateExtensions(value) {
  const text = boundedString(value, 'supported_extensions', { maximum: 2048 });
  const extensions = text.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (extensions.length > 100 || extensions.some((item) => !/^\.[a-z0-9]{1,10}$/.test(item))) {
    throw new ValidationError('supported_extensions contains an invalid extension');
  }
  return [...new Set(extensions)].join(',');
}

function validateServerUrl(value) {
  const text = boundedString(value, 'ntfy_server', { required: true, maximum: 2048 });
  let url;
  try { url = new URL(text); } catch { throw new ValidationError('ntfy_server must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ValidationError('ntfy_server must use HTTP(S) without embedded credentials');
  }
  return url.toString().replace(/\/$/, '');
}

function validateSettingsUpdate(input) {
  const pairs = plainObject(input);
  const result = {};
  for (const [key, value] of Object.entries(pairs)) {
    if (BOOLEAN_KEYS.has(key)) {
      result[key] = enumValue(String(value), key, ['true', 'false']);
    } else if (INTEGER_RANGES[key]) {
      const [minimum, maximum] = INTEGER_RANGES[key];
      result[key] = String(boundedInteger(value, key, { minimum, maximum }));
    } else if (ENUM_KEYS[key]) {
      result[key] = enumValue(value, key, ENUM_KEYS[key]);
    } else if (STRING_LIMITS[key]) {
      if ((key === 'ntfy_auth_token' || key === 'ntfy_password') && value === null) {
        result[key] = null;
      } else {
        result[key] = boundedString(value, key, { maximum: STRING_LIMITS[key] });
      }
    } else if (key === 'ntfy_server') {
      result[key] = validateServerUrl(value);
    } else if (key === 'supported_extensions') {
      result[key] = validateExtensions(value);
    } else {
      throw new ValidationError(`Unknown setting: ${key}`);
    }
  }
  return result;
}

module.exports = { validateSettingsUpdate };