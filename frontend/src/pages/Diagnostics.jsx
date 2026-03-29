import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchDiagnostics, fetchLogs, logStreamUrl } from '../api';
import { RefreshCw, Radio, Search } from 'lucide-react';
import StatCard from '../components/StatCard';
import SparklineCard from '../components/SparklineCard';
import PillTabs from '../components/PillTabs';

const LOG_LEVELS = [
  { value: 'all',   label: 'All' },
  { value: 'info',  label: 'Info' },
  { value: 'api',   label: 'API' },
  { value: 'warn',  label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const API_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//;

const MAX_LOG_ENTRIES = 500;

export default function Diagnostics() {
  const [diag, setDiag] = useState(null);
  const [logs, setLogs] = useState([]);
  const [levelFilter, setLevelFilter] = useState('all');
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const logsContainerRef = useRef(null);
  const userScrolledRef = useRef(false);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    fetchDiagnostics().then(setDiag).catch(console.error);
    /* Load initial logs then start streaming */
    fetchLogs().then((initial) => {
      setLogs(initial);
      startStream();
    }).catch(console.error);

    /* Poll diagnostics every 5s to keep CPU/memory sparklines updating */
    const diagTimer = setInterval(() => {
      fetchDiagnostics().then(setDiag).catch(() => {});
    }, 5000);

    return () => {
      stopStream();
      clearInterval(diagTimer);
    };
  }, []);

  /* Auto-scroll logs to bottom unless user has scrolled up */
  useEffect(() => {
    if (logs.length && logsContainerRef.current && !userScrolledRef.current) {
      const el = logsContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, levelFilter]);

  const startStream = useCallback(() => {
    stopStream();
    const es = new EventSource(logStreamUrl);
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data);
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
        });
      } catch { /* malformed event — ignore */ }
    };
    es.onopen = () => setStreaming(true);
    es.onerror = () => setStreaming(false);
    eventSourceRef.current = es;
  }, []);

  const stopStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setStreaming(false);
    }
  }, []);

  const toggleStream = useCallback(() => {
    if (paused) {
      startStream();
      setPaused(false);
    } else {
      stopStream();
      setPaused(true);
    }
  }, [paused, startStream, stopStream]);

  const refresh = () => {
    fetchDiagnostics().then(setDiag).catch(console.error);
    fetchLogs().then((fresh) => {
      setLogs(fresh);
      startStream();
    }).catch(console.error);
  };

  const formatUptime = (s) =>
    s >= 3600
      ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
      : `${Math.floor(s / 60)}m ${s % 60}s`;

  const versionColor = (v) => v === 'NOT FOUND' ? 'red' : 'green';

  const isApiLog = (l) => l.level === 'info' && API_PATTERN.test(l.message);

  let filteredLogs = levelFilter === 'all'
    ? logs
    : levelFilter === 'api'
      ? logs.filter(isApiLog)
      : levelFilter === 'info'
        ? logs.filter((l) => l.level === 'info' && !API_PATTERN.test(l.message))
        : logs.filter((l) => l.level === levelFilter);

  if (searchFilter) {
    try {
      const re = new RegExp(searchFilter, 'i');
      filteredLogs = filteredLogs.filter((l) => re.test(l.message));
    } catch {
      /* invalid regex — treat as plain substring */
      const lower = searchFilter.toLowerCase();
      filteredLogs = filteredLogs.filter((l) => l.message.toLowerCase().includes(lower));
    }
  }

  const apiCount = logs.filter(isApiLog).length;
  const levelCounts = logs.reduce((acc, l) => { acc[l.level] = (acc[l.level] || 0) + 1; return acc; }, {});
  const tabs = LOG_LEVELS.map((l) => ({
    ...l,
    count: l.value === 'all' ? logs.length
      : l.value === 'api' ? apiCount
      : l.value === 'info' ? (levelCounts.info || 0) - apiCount
      : (levelCounts[l.value] || 0),
  }));

  return (
    <>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Diagnostics</h2>
          <p>System information and recent logs</p>
        </div>
        <button className="btn primary" onClick={refresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="page-body">
        {diag ? (
          <>
            <div className="stat-grid" style={{ marginBottom: 0 }}>
              <SparklineCard
                label="CPU"
                value={`${diag.cpuPercent ?? 0}%`}
                data={(diag.cpuHistory || []).map((h) => h.cpu)}
                variant="cyan"
              />
              <SparklineCard
                label="Memory"
                value={`${diag.memoryMBCurrent ?? diag.memoryMB} MB`}
                data={(diag.memoryHistory || []).map((h) => h.mem)}
                variant="accent"
              />
              <StatCard label="Uptime" value={formatUptime(diag.uptime)} variant="green" />
            </div>
            <div className="stat-grid" style={{ marginBottom: 0 }}>
              <StatCard label="Version" value={diag.version} variant="accent" />
              <StatCard label="Node.js" value={diag.nodeVersion} variant="cyan" />
              <StatCard label="Python" value={diag.pythonVersion} variant={versionColor(diag.pythonVersion)} />
              <StatCard label="ExifTool" value={diag.exiftoolVersion} variant={versionColor(diag.exiftoolVersion)} />
              <StatCard label="Platform" value={`${diag.platform}/${diag.arch}`} variant="accent" />
            </div>
          </>
        ) : (
          <div className="card"><p style={{ opacity: 0.5 }}>Loading…</p></div>
        )}

        {diag?.mounts?.length > 0 && (
          <div className="card">
            <div className="card-header"><h3>Volume Mounts (/mnt)</h3></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
              {diag.mounts.map((m) => (
                <div key={m.path} className="mono" style={{
                  fontSize: 12, padding: '6px 10px', borderRadius: 6,
                  background: 'var(--bg-active)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>{m.path}</span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: m.writable ? 'var(--green)' : 'var(--orange)' }}>
                      {m.writable ? 'rw' : 'ro'}
                    </span>
                    <span style={{ opacity: 0.5 }}>{m.entries} items</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header flex justify-between items-center">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3>Logs</h3>
              <button
                onClick={toggleStream}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 99,
                  border: 'none', cursor: 'pointer',
                  background: streaming ? 'var(--green-muted)' : 'var(--orange-muted)',
                  color: streaming ? 'var(--green)' : 'var(--orange)',
                }}
                title={streaming ? 'Click to pause' : 'Click to resume'}
              >
                <Radio size={10} /> {streaming ? 'Live' : paused ? 'Paused' : 'Disconnected'}
              </button>
            </div>
            <PillTabs tabs={tabs} active={levelFilter} onChange={setLevelFilter} />
          </div>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              className="form-input mono"
              type="text"
              placeholder="Filter logs (regex supported)"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ width: '100%', paddingLeft: 30, fontSize: 12 }}
            />
          </div>
          {filteredLogs.length > 0 ? (
            <div
              ref={logsContainerRef}
              onScroll={() => {
                const el = logsContainerRef.current;
                if (!el) return;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                userScrolledRef.current = !atBottom;
              }}
              style={{
                maxHeight: 480, overflow: 'auto', background: 'var(--bg-main)',
                borderRadius: 6, padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono)',
                lineHeight: 1.6, border: '1px solid var(--border)',
              }}
            >
              {filteredLogs.map((entry, i) => (
                <div key={i} style={{ color: entry.level === 'error' ? 'var(--red)' : entry.level === 'warn' ? 'var(--orange)' : 'var(--text-secondary)' }}>
                  <span style={{ opacity: 0.4 }}>{entry.ts.slice(11, 19)}</span>{' '}
                  <span style={{
                    display: 'inline-block', width: 40, textAlign: 'right', marginRight: 8,
                    color: entry.level === 'error' ? 'var(--red)' : entry.level === 'warn' ? 'var(--orange)' : 'var(--text-muted)',
                    opacity: 0.7,
                  }}>{entry.level}</span>
                  {entry.message}
                </div>
              ))}
            </div>
          ) : (
            <p className="form-hint">
              {logs.length === 0 ? 'No logs yet. Logs will stream in real time.' : `No ${levelFilter} logs found.`}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
