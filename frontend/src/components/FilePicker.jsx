import { useState, useEffect, useCallback } from 'react';
import { browseDirectory, fetchFilesystemRoots, fetchDrives } from '../api';

/**
 * Server-side file/folder picker.
 *
 * Props:
 *   open       – boolean
 *   title      – modal title
 *   onSelect   – (path: string) => void
 *   onClose    – () => void
 *   selectMode – 'directory' (default) | 'file'
 */
export default function FilePicker({ open, title = 'Select Directory', onSelect, onClose, selectMode = 'directory' }) {
  const [currentDir, setCurrentDir] = useState(null);
  const [entries, setEntries] = useState([]);
  const [parentDir, setParentDir] = useState(null);
  const [roots, setRoots] = useState([]);
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('browse'); // 'browse' | 'drives'

  /* Load filesystem roots + drives on mount */
  useEffect(() => {
    if (!open) return;
    fetchFilesystemRoots().then(setRoots).catch(() => {});
    fetchDrives().then(setDrives).catch(() => setDrives([]));
  }, [open]);

  /* Browse a directory */
  const browse = useCallback(async (dir) => {
    setLoading(true);
    setError(null);
    try {
      const data = await browseDirectory(dir, selectMode === 'file');
      setCurrentDir(data.current);
      setParentDir(data.parent);
      setEntries(data.entries);
      setTab('browse');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectMode]);

  /* Initial browse */
  useEffect(() => {
    if (open && !currentDir) browse();
  }, [open, currentDir, browse]);

  if (!open) return null;

  const driveIcon = (type) => {
    switch (type) {
      case 'usb': return '🔌';
      case 'nvme': return '⚡';
      case 'sata': return '💽';
      case 'docker-volume': return '🐳';
      default: return '💾';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 680, minHeight: 480 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <button
            className={`pill-tab ${tab === 'browse' ? 'active' : ''}`}
            style={{ borderRadius: 0, flex: 1 }}
            onClick={() => setTab('browse')}
          >
            📁 Browse
          </button>
          <button
            className={`pill-tab ${tab === 'drives' ? 'active' : ''}`}
            style={{ borderRadius: 0, flex: 1 }}
            onClick={() => setTab('drives')}
          >
            💾 Drives ({drives.length})
          </button>
        </div>

        <div className="modal-body" style={{ minHeight: 320, maxHeight: 420, overflowY: 'auto' }}>
          {tab === 'drives' ? (
            /* ---- Drives panel ---- */
            <div>
              {drives.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">💾</div>
                  <h3>No external drives detected</h3>
                  <p>Connect a USB, SATA, or NVMe drive and refresh.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {drives.map((d, i) => (
                    <button
                      key={i}
                      className="file-picker-entry"
                      onClick={() => browse(d.path)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 14px', background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                        color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                        width: '100%', fontFamily: 'var(--font-ui)', fontSize: 13,
                      }}
                    >
                      <span style={{ fontSize: 22 }}>{driveIcon(d.type)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{d.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {d.path}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <span className={`badge ${d.type === 'usb' ? 'cyan' : d.type === 'nvme' ? 'pink' : 'accent'}`}>
                          {d.type}
                        </span>
                        {d.removable && <span className="badge orange">Removable</span>}
                      </div>
                      {d.size && <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{d.size}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ---- Browse panel ---- */
            <div>
              {/* Current path + quick nav */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {roots.map((r, i) => (
                  <button
                    key={i}
                    className="btn sm"
                    onClick={() => browse(r.path)}
                    title={r.path}
                  >
                    {r.icon} {r.name}
                  </button>
                ))}
              </div>

              {/* Breadcrumb */}
              <div style={{
                padding: '8px 12px', marginBottom: 12,
                background: 'var(--bg-input)', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', fontFamily: 'var(--font-mono)',
                fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all',
              }}>
                {currentDir || '…'}
              </div>

              {error && (
                <div style={{ padding: 12, background: 'var(--red-muted)', borderRadius: 'var(--radius-md)', color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>
                  {error}
                </div>
              )}

              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Parent directory */}
                  {parentDir && parentDir !== currentDir && (
                    <button
                      onClick={() => browse(parentDir)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 12px', background: 'none',
                        border: 'none', borderRadius: 'var(--radius-md)',
                        color: 'var(--text-secondary)', cursor: 'pointer',
                        fontFamily: 'var(--font-ui)', fontSize: 13, textAlign: 'left',
                        width: '100%',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      <span style={{ width: 20, textAlign: 'center' }}>⬆</span>
                      <span>..</span>
                    </button>
                  )}

                  {entries.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => {
                        if (entry.type === 'directory') browse(entry.path);
                      }}
                      onDoubleClick={() => {
                        if (selectMode === 'file' && entry.type === 'file') onSelect(entry.path);
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 12px', background: 'none',
                        border: 'none', borderRadius: 'var(--radius-md)',
                        color: 'var(--text-primary)', cursor: 'pointer',
                        fontFamily: 'var(--font-ui)', fontSize: 13, textAlign: 'left',
                        width: '100%',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      <span style={{ width: 20, textAlign: 'center' }}>
                        {entry.type === 'directory' ? '📁' : '📄'}
                      </span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.name}
                      </span>
                      {entry.size && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {(entry.size / 1024).toFixed(0)} KB
                        </span>
                      )}
                    </button>
                  ))}

                  {entries.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
                      Empty directory
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — select current directory */}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          {selectMode === 'directory' && (
            <button
              className="btn primary"
              onClick={() => { if (currentDir) onSelect(currentDir); }}
              disabled={!currentDir}
            >
              Select "{currentDir?.split('/').pop() || '/'}"
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
