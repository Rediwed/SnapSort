'use strict';

/**
 * Security helpers: CORS allowlist, optional token auth, secret masking,
 * and safe default bind host.
 *
 * Design for a self-hosted app:
 *   - CORS is restricted to an explicit allowlist and is NEVER "*".
 *   - When SNAPSORT_AUTH_TOKEN is set, every /api route except /api/health
 *     requires a matching bearer token (constant-time compared).
 *   - When no token is set, auth is disabled but the server binds to
 *     loopback only (unless SNAPSORT_ALLOW_LAN=true or HOST is set), so an
 *     unauthenticated instance is not reachable from the network by default.
 */

const crypto = require('crypto');

/* ------------------------------------------------------------------ */
/*  Secret masking                                                     */
/* ------------------------------------------------------------------ */
const SECRET_KEY_PATTERN = /(password|token|api_key|apikey|secret)/i;
/* Sentinel returned in place of a stored secret; echoed back unchanged means "keep". */
const MASK = '__snapsort_secret_kept__';

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key));
}

/** Return a shallow copy of a settings object with secret values masked. */
function maskSecrets(settings) {
  const out = {};
  for (const [key, value] of Object.entries(settings || {})) {
    out[key] = isSecretKey(key) ? (value ? MASK : '') : value;
  }
  return out;
}

/** True when an incoming value is the mask sentinel (i.e. "leave the secret unchanged"). */
function isMaskedValue(value) {
  return value === MASK;
}

/* ------------------------------------------------------------------ */
/*  CORS                                                               */
/* ------------------------------------------------------------------ */
function getAllowedOrigins() {
  const fromEnv = (process.env.SNAPSORT_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  /* Sensible dev defaults (Vite + same-origin). Never wildcard. */
  return [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:5174', 'http://127.0.0.1:5174',
    'http://localhost:5175', 'http://127.0.0.1:5175',
    'http://localhost:4000', 'http://127.0.0.1:4000',
  ];
}

function corsOptions() {
  const allowed = new Set(getAllowedOrigins());
  return {
    origin(origin, cb) {
      /* Same-origin / non-browser requests carry no Origin header — allow. */
      if (!origin) return cb(null, true);
      return cb(null, allowed.has(origin));
    },
    credentials: true,
  };
}

/* ------------------------------------------------------------------ */
/*  Token auth                                                         */
/* ------------------------------------------------------------------ */
function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isAuthEnabled() {
  return Boolean(process.env.SNAPSORT_AUTH_TOKEN);
}

/**
 * Express middleware factory. When a token is configured, requires
 * `Authorization: Bearer <token>` (or `X-SnapSort-Token`) on every request
 * except the health check. When not configured, it is a no-op.
 */
function authMiddleware() {
  const token = process.env.SNAPSORT_AUTH_TOKEN;
  if (!token) return (_req, _res, next) => next();
  return (req, res, next) => {
    if (req.path === '/api/health') return next();
    /* Allow SSE EventSource (cannot set headers) to authenticate via query token. */
    const header = req.get('authorization') || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const provided = bearer || req.get('x-snapsort-token') || req.query.token || '';
    if (provided && constantTimeEqual(provided, token)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

/* ------------------------------------------------------------------ */
/*  Bind host                                                          */
/* ------------------------------------------------------------------ */
function resolveBindHost() {
  if (process.env.HOST) return process.env.HOST;
  const allowLan = String(process.env.SNAPSORT_ALLOW_LAN || '').toLowerCase() === 'true';
  /* Expose on all interfaces only when auth is on, or the user opts in explicitly. */
  if (isAuthEnabled() || allowLan) return '0.0.0.0';
  return '127.0.0.1';
}

module.exports = {
  isSecretKey,
  maskSecrets,
  isMaskedValue,
  MASK,
  corsOptions,
  getAllowedOrigins,
  authMiddleware,
  isAuthEnabled,
  resolveBindHost,
};
