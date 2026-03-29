/**
 * Browser notification service — broadcasts events via SSE to connected
 * browser tabs, which then show native Notification API popups.
 *
 * The SSE endpoint lives in routes/settings.js at
 *   GET /api/settings/notifications/stream
 */

const subscribers = new Map();
let nextId = 1;

/** Register an SSE client callback. Returns an id for unsubscribe. */
function subscribe(fn) {
  const id = nextId++;
  subscribers.set(id, fn);
  return id;
}

/** Remove an SSE client by id. */
function unsubscribe(id) {
  subscribers.delete(id);
}

/**
 * Broadcast a notification event to all connected browser tabs.
 * @param {{ type: string, title: string, body: string }} event
 */
function broadcast(event) {
  for (const fn of subscribers.values()) {
    try {
      fn(event);
    } catch {
      /* subscriber error — ignore */
    }
  }
}

/** Send a test notification to all connected browsers. */
function sendTestBrowserNotification() {
  broadcast({
    type: 'test',
    title: '🔔 SnapSort Test',
    body: 'Browser notifications are working!',
  });
}

module.exports = { subscribe, unsubscribe, broadcast, sendTestBrowserNotification };
