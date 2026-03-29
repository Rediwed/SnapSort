import { useEffect, useRef } from 'react';
import { fetchSettings } from '../api';

/**
 * Hook that connects to the backend SSE notification stream and shows
 * native browser notifications (Notification API) when events arrive.
 *
 * Automatically reconnects if the EventSource drops.
 * Requests notification permission on mount when browser_notify_enabled is true.
 */
export default function useNotifications() {
  const esRef = useRef(null);
  const enabledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const settings = await fetchSettings();
        if (cancelled) return;
        enabledRef.current = settings.browser_notify_enabled === 'true';
        if (!enabledRef.current) return;

        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
          await Notification.requestPermission();
        }

        connect();
      } catch {
        // Settings fetch failed — retry after delay
        if (!cancelled) setTimeout(init, 5000);
      }
    }

    function connect() {
      if (cancelled) return;
      const es = new EventSource('/api/settings/notifications/stream');
      esRef.current = es;

      es.onmessage = (e) => {
        if (!enabledRef.current) return;
        try {
          const event = JSON.parse(e.data);
          showNotification(event);
        } catch {
          /* malformed event — ignore */
        }
      };

      es.onerror = () => {
        es.close();
        // Reconnect after 3 seconds
        if (!cancelled) setTimeout(connect, 3000);
      };
    }

    init();

    // Re-check settings periodically to pick up enable/disable changes
    const pollId = setInterval(async () => {
      try {
        const settings = await fetchSettings();
        const wasEnabled = enabledRef.current;
        enabledRef.current = settings.browser_notify_enabled === 'true';

        // If just enabled and no active SSE connection, start one
        if (enabledRef.current && !wasEnabled && !esRef.current) {
          if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
          }
          connect();
        }
      } catch {
        /* ignore */
      }
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);
}

function showNotification({ title, body }) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    new Notification(title, {
      body: body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
    });
  } catch {
    /* Notification constructor can fail on some mobile browsers */
  }
}
