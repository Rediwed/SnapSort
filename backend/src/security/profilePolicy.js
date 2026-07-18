const { ValidationError, boundedInteger, boundedString, plainObject } = require('./validation');

const ALLOWED_KEYS = new Set([
  'name', 'description', 'max_workers', 'batch_size', 'hash_bytes',
  'concurrent_copies', 'enable_multithreading', 'sequential_processing',
]);

function booleanValue(value, name) {
  if (typeof value !== 'boolean') throw new ValidationError(`${name} must be a boolean`);
  return value;
}

function validateProfile(input, { partial = false } = {}) {
  const body = plainObject(input);
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) throw new ValidationError(`Unknown profile field: ${key}`);
  }
  const result = {};
  if (!partial || body.name !== undefined) {
    result.name = boundedString(body.name, 'name', { required: true, maximum: 100 });
  }
  if (body.description !== undefined) result.description = boundedString(body.description, 'description', { maximum: 500 });
  for (const [key, minimum, maximum, fallback] of [
    ['max_workers', 1, 64, 4],
    ['batch_size', 1, 1000, 25],
    ['hash_bytes', 512, 1024 * 1024, 4096],
    ['concurrent_copies', 1, 32, 2],
  ]) {
    if (!partial || body[key] !== undefined) {
      result[key] = boundedInteger(body[key], key, { minimum, maximum, defaultValue: fallback });
    }
  }
  for (const key of ['enable_multithreading', 'sequential_processing']) {
    if (!partial || body[key] !== undefined) result[key] = booleanValue(body[key] ?? false, key);
  }
  return result;
}

module.exports = { validateProfile };