/**
 * In-memory ring-buffer that captures recent log output so the
 * web UI can display it without SSH / `docker logs`.
 *
 * Usage:
 *   const { initLogCapture, getRecentLogs, subscribe, unsubscribe } = require('./logBuffer');
 *   initLogCapture();           // call once at startup
 *   getRecentLogs(100);         // returns last 100 entries
 *   const id = subscribe(fn);   // fn(entry) called on each new log
 *   unsubscribe(id);            // stop receiving
 */

const MAX_ENTRIES = 500;
const buffer = [];
const subscribers = new Map();
let nextSubId = 1;

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
    const entry = { ts: new Date().toISOString(), level, message: line };
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
    for (const fn of subscribers.values()) {
      try { fn(entry); } catch { /* subscriber error — ignore */ }
    }
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

/** Subscribe to new log entries. Returns a numeric id for unsubscribe. */
function subscribe(fn) {
  const id = nextSubId++;
  subscribers.set(id, fn);
  return id;
}

/** Unsubscribe by id. */
function unsubscribe(id) {
  subscribers.delete(id);
}

module.exports = { initLogCapture, getRecentLogs, subscribe, unsubscribe };
