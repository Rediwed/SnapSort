import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchSettings } from './api';

const SettingsContext = createContext({});

function applyTheme(theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme || 'dark');
  }
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({});

  const refresh = useCallback(() => {
    fetchSettings().then((s) => {
      setSettings(s);
      applyTheme(s.theme);
    }).catch(console.error);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /* Listen for OS theme changes when set to 'system' */
  useEffect(() => {
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [settings.theme]);

  return (
    <SettingsContext.Provider value={{ ...settings, _refresh: refresh }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
