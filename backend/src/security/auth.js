const crypto = require('crypto');

const MIN_PASSWORD_LENGTH = 16;
const MAX_AUTH_HEADER_LENGTH = 4096;
const MAX_AUTH_FAILURES = 10;
const AUTH_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 10000;

class AuthConfigurationError extends Error {}

function readAuthConfig(env = process.env) {
  const username = (env.SNAPSORT_AUTH_USERNAME || '').trim();
  const password = env.SNAPSORT_AUTH_PASSWORD || '';
  const hasUsername = username.length > 0;
  const hasPassword = password.length > 0;

  if (hasUsername !== hasPassword) {
    throw new AuthConfigurationError(
      'SNAPSORT_AUTH_USERNAME and SNAPSORT_AUTH_PASSWORD must be configured together',
    );
  }

  if (!hasUsername) {
    if (env.NODE_ENV === 'production') {
      throw new AuthConfigurationError(
        'Production requires SNAPSORT_AUTH_USERNAME and SNAPSORT_AUTH_PASSWORD',
      );
    }
    return { enabled: false };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthConfigurationError(
      `SNAPSORT_AUTH_PASSWORD must contain at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  return { enabled: true, username, password };
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function credentialsMatch(actual, expected) {
  return crypto.timingSafeEqual(digest(actual), digest(expected));
}

function parseBasicCredentials(header) {
  if (typeof header !== 'string' || header.length > MAX_AUTH_HEADER_LENGTH) return null;
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match) return null;

  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function createAuthMiddleware(config) {
  if (!config.enabled) return (_req, _res, next) => next();

  const expected = `${config.username}:${config.password}`;
  const failures = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const client = req.ip || req.socket?.remoteAddress || 'unknown';
    let failureState = failures.get(client);
    if (failureState && now - failureState.startedAt >= AUTH_FAILURE_WINDOW_MS) {
      failures.delete(client);
      failureState = null;
    }
    if (failureState && failureState.count >= MAX_AUTH_FAILURES) {
      const remainingMs = AUTH_FAILURE_WINDOW_MS - (now - failureState.startedAt);
      res.set('Retry-After', String(Math.max(1, Math.ceil(remainingMs / 1000))));
      return res.status(429).json({ error: 'Too many authentication failures' });
    }

    const credentials = parseBasicCredentials(req.get('authorization'));
    const actual = credentials ? `${credentials.username}:${credentials.password}` : '';
    if (credentials && credentialsMatch(actual, expected)) {
      failures.delete(client);
      return next();
    }

    if (failures.size >= MAX_TRACKED_CLIENTS && !failures.has(client)) {
      failures.delete(failures.keys().next().value);
    }
    failures.set(client, {
      count: (failureState?.count || 0) + 1,
      startedAt: failureState?.startedAt || now,
    });

    res.set('WWW-Authenticate', 'Basic realm="SnapSort", charset="UTF-8"');
    return res.status(401).json({ error: 'Authentication required' });
  };
}

module.exports = {
  AuthConfigurationError,
  AUTH_FAILURE_WINDOW_MS,
  MAX_AUTH_FAILURES,
  MIN_PASSWORD_LENGTH,
  createAuthMiddleware,
  parseBasicCredentials,
  readAuthConfig,
};