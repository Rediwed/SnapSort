/**
 * In-memory ring-buffer that captures recent log output so the
 * web UI can display it without SSH / `docker logs`.
 *
 * Usage:
 *   const { initLogCapture, getRecentLogs } = require('./logBuffer');
 *   initLogCapture();           // call once at startup
 *   getRecentLogs(100);         // returns last 100 entries
 */

const MAX_ENTRIES = 500;
const buffer = [];

/**
 * Patch console.log / console.error / console.warn so every call
 * is also pushed into the ring buffer.
 */
function initLogCapture() {
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  function push(level, args) {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    buffer.push({ ts: new Date().toISOString(), level, message: line });
    if (buffer.length > MAX_ENTRIES) buffer.shift();
  }

  console.log = (...args) => { push('info', args); origLog(...args); };
  console.error = (...args) => { push('error', args); origErr(...args); };
  console.warn = (...args) => { push('warn', args); origWarn(...args); };
}

/**
 * Return the most recent `n` log entries (default 200).
 */
function getRecentLogs(n = 200) {
  return buffer.slice(-n);
}

module.exports = { initLogCapture, getRecentLogs };
