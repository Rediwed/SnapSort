class ValidationError extends Error {}

function boundedInteger(value, name, { defaultValue, minimum = 0, maximum }) {
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new ValidationError(`${name} is required`);
  }
  const text = String(value);
  if (!/^-?\d+$/.test(text)) throw new ValidationError(`${name} must be an integer`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ValidationError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function boundedString(value, name, { required = false, maximum = 255 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${name} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ValidationError(`${name} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) throw new ValidationError(`${name} is required`);
  if (normalized.length > maximum) {
    throw new ValidationError(`${name} must contain at most ${maximum} characters`);
  }
  return normalized;
}

function enumValue(value, name, allowed, defaultValue) {
  const candidate = value === undefined ? defaultValue : value;
  if (!allowed.includes(candidate)) {
    throw new ValidationError(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return candidate;
}

function idArray(value, name, { maximum = 500 } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${name} must be a non-empty array`);
  }
  if (value.length > maximum) {
    throw new ValidationError(`${name} must contain at most ${maximum} items`);
  }
  const unique = [];
  const seen = new Set();
  for (const item of value) {
    const id = boundedString(item, `${name} item`, { required: true, maximum: 100 });
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
}

function plainObject(value, name = 'Body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${name} must be a JSON object`);
  }
  return value;
}

function validateForResponse(res, callback) {
  try {
    return { ok: true, value: callback() };
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return { ok: false, value: undefined };
    }
    throw error;
  }
}

module.exports = {
  ValidationError,
  boundedInteger,
  boundedString,
  enumValue,
  idArray,
  plainObject,
  validateForResponse,
};