const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AuthConfigurationError,
  MAX_AUTH_FAILURES,
  createAuthMiddleware,
  parseBasicCredentials,
  readAuthConfig,
} = require('../src/security/auth');

const PASSWORD = 'correct-horse-battery-staple';

test('requires credentials in production', () => {
  assert.throws(
    () => readAuthConfig({ NODE_ENV: 'production' }),
    AuthConfigurationError,
  );
});

test('requires username and password together', () => {
  assert.throws(
    () => readAuthConfig({ SNAPSORT_AUTH_USERNAME: 'admin' }),
    /configured together/,
  );
});

test('rejects short passwords', () => {
  assert.throws(
    () => readAuthConfig({
      SNAPSORT_AUTH_USERNAME: 'admin',
      SNAPSORT_AUTH_PASSWORD: 'too-short',
    }),
    /at least 16 characters/,
  );
});

test('allows unauthenticated non-production development', () => {
  assert.deepEqual(readAuthConfig({ NODE_ENV: 'development' }), { enabled: false });
});

test('parses Basic credentials containing colons in the password', () => {
  const encoded = Buffer.from(`admin:${PASSWORD}:suffix`).toString('base64');
  assert.deepEqual(parseBasicCredentials(`Basic ${encoded}`), {
    username: 'admin',
    password: `${PASSWORD}:suffix`,
  });
});

test('auth middleware challenges missing credentials', () => {
  const middleware = createAuthMiddleware({ enabled: true, username: 'admin', password: PASSWORD });
  const response = {
    headers: {},
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;

  middleware({ get: () => undefined }, response, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 401);
  assert.match(response.headers['WWW-Authenticate'], /^Basic realm=/);
});

test('auth middleware accepts exact credentials', () => {
  const middleware = createAuthMiddleware({ enabled: true, username: 'admin', password: PASSWORD });
  const authorization = `Basic ${Buffer.from(`admin:${PASSWORD}`).toString('base64')}`;
  let nextCalled = false;

  middleware({ get: () => authorization }, {}, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test('auth middleware throttles repeated failures per client', () => {
  const middleware = createAuthMiddleware({ enabled: true, username: 'admin', password: PASSWORD });
  const request = { ip: '192.0.2.10', get: () => undefined };

  for (let attempt = 0; attempt < MAX_AUTH_FAILURES; attempt += 1) {
    const response = {
      set() {},
      status(code) { this.statusCode = code; return this; },
      json() { return this; },
    };
    middleware(request, response, () => {});
    assert.equal(response.statusCode, 401);
  }

  const blockedResponse = {
    headers: {},
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  middleware(request, blockedResponse, () => {});

  assert.equal(blockedResponse.statusCode, 429);
  assert.ok(Number(blockedResponse.headers['Retry-After']) > 0);
});