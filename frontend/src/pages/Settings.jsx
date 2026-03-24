import { useState, useEffect } from 'react';
import { fetchSettings, updateSettings, fetchProfiles, fetchDiagnostics, fetchLogs } from '../api';
import { Check, RefreshCw } from 'lucide-react';

const DEFAULT_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.cr2', '.nef', '.arw',
  '.tif', '.tiff', '.rw2', '.orf', '.dng', '.heic', '.heif',
];

const settingsMeta = [
  { key: 'min_width',              label: 'Min Width (px)',           type: 'number' },
  { key: 'min_height',             label: 'Min Height (px)',          type: 'number' },
  { key: 'min_filesize',           label: 'Min File Size (bytes)',    type: 'number' },
  { key: 'dedup_strict_threshold', label: 'Dedup Strict Threshold (%)', type: 'number' },
  { key: 'dedup_log_threshold',    label: 'Dedup Log Threshold (%)',    type: 'number' },
];

export default function Settings() {
  const [values, setValues] = useState({});
  const [profiles, setProfiles] = useState([]);
  const [saved, setSaved] = useState(false);
  const [newExt, setNewExt] = useState('');
  const [diag, setDiag] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    fetchSettings().then(setValues).catch(console.error);
    fetchProfiles().then(setProfiles).catch(console.error);
    fetchDiagnostics().then(setDiag).catch(console.error);
  }, []);

  /* Derived: current extension list */
  const extensions = values.supported_extensions
    ? values.supported_extensions.split(',').map((e) => e.trim()).filter(Boolean)
    : DEFAULT_EXTENSIONS;

  const handleChange = (key, val) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  };

  const handleSave = async () => {
    await updateSettings(values);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  /* Extension helpers */
  const removeExt = (ext) => {
    const next = extensions.filter((e) => e !== ext);
    handleChange('supported_extensions', next.join(','));
  };

  const addExt = () => {
    let e = newExt.trim().toLowerCase();
    if (!e) return;
    if (!e.startsWith('.')) e = '.' + e;
    if (extensions.includes(e)) { setNewExt(''); return; }
    handleChange('supported_extensions', [...extensions, e].join(','));
    setNewExt('');
  };

  const resetExts = () => {
    handleChange('supported_extensions', DEFAULT_EXTENSIONS.join(','));
  };

  /* Performance values */
  const selectedProfileId = values.default_performance_profile || 'default';
  const enableMT = values.enable_multithreading === 'true';
  const seqProcessing = values.sequential_processing === 'true';
  const maxWorkers = Number(values.max_worker_threads) || 4;
  const hashWorkers = Number(values.parallel_hash_workers) || 4;
  const batchSize = Number(values.batch_size) || 25;
  const hashSampleBytes = Number(values.fast_hash_bytes) || 8192;
  const concurrentCopies = Number(values.concurrent_copies) || 2;
  const cpuCount = navigator.hardwareConcurrency || 4;
  const enableFastHash = values.enable_fast_hash === 'true';

  /* Apply a profile's values to the settings */
  const applyProfile = (profileId) => {
    const p = profiles.find((pr) => pr.id === profileId);
    if (!p) return;
    setValues((prev) => ({
      ...prev,
      default_performance_profile: profileId,
      enable_multithreading: p.enable_multithreading ? 'true' : 'false',
      sequential_processing: p.sequential_processing ? 'true' : 'false',
      max_worker_threads: String(p.max_workers),
      batch_size: String(p.batch_size),
      fast_hash_bytes: String(p.hash_bytes),
      concurrent_copies: String(p.concurrent_copies),
    }));
    setSaved(false);
  };

  return (
    <>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Settings</h2>
          <p>Configure the SnapSort engine defaults</p>
        </div>
        <button className="btn primary" onClick={handleSave}>
          {saved ? <><Check size={14} /> Saved</> : 'Save Settings'}
        </button>
      </div>

      <div className="page-body">
        <div className="settings-grid">
        {/* ── Filter & Quality ─────────────────────────────── */}
        <div className="card">
          <div className="card-header"><h3>Filter &amp; Quality</h3></div>
          {settingsMeta.map((s) => (
            <div className="form-group" key={s.key}>
              {s.type === 'toggle' ? (
                <label className="form-toggle">
                  <input
                    type="checkbox"
                    checked={values[s.key] === 'true'}
                    onChange={(e) => handleChange(s.key, e.target.checked ? 'true' : 'false')}
                  />
                  <span>{s.label}</span>
                </label>
              ) : (
                <>
                  <label>{s.label}</label>
                  <input
                    className="form-input mono"
                    type="number"
                    value={values[s.key] || ''}
                    onChange={(e) => handleChange(s.key, e.target.value)}
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* ── Performance ──────────────────────────────────── */}
        <div className="card">
          <div className="card-header"><h3>Performance</h3></div>

          {/* Profile selector */}
          <div className="form-group">
            <label>Performance Profile</label>
            <select
              className="form-select"
              value={selectedProfileId}
              onChange={(e) => applyProfile(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.is_builtin ? '' : ' (custom)'}
                </option>
              ))}
            </select>
            {profiles.find((p) => p.id === selectedProfileId)?.description && (
              <p className="form-hint">
                {profiles.find((p) => p.id === selectedProfileId).description}
              </p>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

          {/* Enable Multi-threading */}
          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={enableMT}
                onChange={(e) => handleChange('enable_multithreading', e.target.checked ? 'true' : 'false')}
              />
              <span>Enable Multi-threading</span>
            </label>
            <p className="form-hint">
              Use parallel workers to process photos concurrently.
            </p>
          </div>

          {/* Sequential Processing */}
          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={seqProcessing}
                onChange={(e) => handleChange('sequential_processing', e.target.checked ? 'true' : 'false')}
              />
              <span>Sequential Processing</span>
            </label>
            <p className="form-hint">
              Process files one-by-one in order. Best for HDDs to avoid random seeks.
            </p>
          </div>

          {/* Max Workers */}
          <div className="form-group">
            <label>Worker Threads <span className="mono badge">{maxWorkers}</span></label>
            <input
              type="range"
              className="form-range"
              min={1}
              max={Math.max(32, cpuCount * 2)}
              value={maxWorkers}
              onChange={(e) => handleChange('max_worker_threads', e.target.value)}
            />
            <div className="range-labels">
              <span>1</span>
              <span>{cpuCount} cores detected</span>
              <span>{Math.max(32, cpuCount * 2)}</span>
            </div>
          </div>

          {/* Hash Workers */}
          <div className="form-group">
            <label>Hash Workers <span className="mono badge">{hashWorkers}</span></label>
            <input
              type="range"
              className="form-range"
              min={1}
              max={16}
              value={hashWorkers}
              onChange={(e) => handleChange('parallel_hash_workers', e.target.value)}
            />
            <div className="range-labels">
              <span>1</span>
              <span>Parallel dedup hashing threads</span>
              <span>16</span>
            </div>
          </div>

          {/* Batch Size */}
          <div className="form-group">
            <label>Batch Size <span className="mono badge">{batchSize}</span></label>
            <input
              type="range"
              className="form-range"
              min={1}
              max={200}
              value={batchSize}
              onChange={(e) => handleChange('batch_size', e.target.value)}
            />
            <div className="range-labels">
              <span>1</span>
              <span>Files per thread batch</span>
              <span>200</span>
            </div>
          </div>

          {/* Enable Fast Hashing */}
          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={enableFastHash}
                onChange={(e) => handleChange('enable_fast_hash', e.target.checked ? 'true' : 'false')}
              />
              <span>Enable Fast Hashing</span>
            </label>
            <p className="form-hint">
              Sample beginning, middle and end of files instead of reading the full content. Much faster on large files, especially on SSDs.
            </p>
          </div>

          {/* Hash Sample Bytes */}
          <div className="form-group">
            <label>Hash Sample Size <span className="mono badge">{hashSampleBytes.toLocaleString()}</span></label>
            <input
              type="range"
              className="form-range"
              min={512}
              max={32768}
              step={512}
              value={hashSampleBytes}
              onChange={(e) => handleChange('fast_hash_bytes', e.target.value)}
            />
            <div className="range-labels">
              <span>512</span>
              <span>Bytes sampled per file for deduplication</span>
              <span>32,768</span>
            </div>
          </div>

          {/* Concurrent Copies */}
          <div className="form-group">
            <label>Concurrent Copies <span className="mono badge">{concurrentCopies}</span></label>
            <input
              type="range"
              className="form-range"
              min={1}
              max={16}
              value={concurrentCopies}
              onChange={(e) => handleChange('concurrent_copies', e.target.value)}
            />
            <div className="range-labels">
              <span>1</span>
              <span>Parallel file copy operations</span>
              <span>16</span>
            </div>
          </div>
        </div>

        {/* ── File Formats ─────────────────────────────────── */}
        <div className="card">
          <div className="card-header flex justify-between items-center">
            <h3>File Formats</h3>
            <button className="btn sm" onClick={resetExts}>Reset Defaults</button>
          </div>
          <p className="form-hint" style={{ marginBottom: 12 }}>
            Only files matching these extensions will be considered during a scan.
          </p>

          <div className="ext-tags">
            {extensions.map((ext) => (
              <span className="ext-tag" key={ext}>
                {ext}
                <button className="ext-tag-remove" onClick={() => removeExt(ext)} title="Remove">×</button>
              </span>
            ))}
          </div>

          <div className="ext-add" style={{ marginTop: 12 }}>
            <input
              className="form-input mono"
              placeholder=".webp"
              value={newExt}
              onChange={(e) => setNewExt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExt()}
              style={{ width: 120, display: 'inline-block', marginRight: 8 }}
            />
            <button className="btn sm" onClick={addExt}>Add</button>
          </div>
        </div>

        {/* ── Diagnostics & Logs ───────────────────────────── */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header flex justify-between items-center">
            <h3>Diagnostics</h3>
            <button
              className="btn sm"
              onClick={() => {
                fetchDiagnostics().then(setDiag).catch(console.error);
                setLogsLoading(true);
                fetchLogs(200).then(setLogs).catch(console.error).finally(() => setLogsLoading(false));
              }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {diag && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div className="stat-mini"><span className="stat-label">Version</span><span className="mono">{diag.version}</span></div>
              <div className="stat-mini"><span className="stat-label">Node.js</span><span className="mono">{diag.nodeVersion}</span></div>
              <div className="stat-mini"><span className="stat-label">Python</span><span className="mono" style={{ color: diag.pythonVersion === 'NOT FOUND' ? 'var(--red)' : undefined }}>{diag.pythonVersion}</span></div>
              <div className="stat-mini"><span className="stat-label">ExifTool</span><span className="mono" style={{ color: diag.exiftoolVersion === 'NOT FOUND' ? 'var(--red)' : undefined }}>{diag.exiftoolVersion}</span></div>
              <div className="stat-mini"><span className="stat-label">Platform</span><span className="mono">{diag.platform}/{diag.arch}</span></div>
              <div className="stat-mini"><span className="stat-label">Uptime</span><span className="mono">{diag.uptime >= 3600 ? `${Math.floor(diag.uptime / 3600)}h ${Math.floor((diag.uptime % 3600) / 60)}m` : `${Math.floor(diag.uptime / 60)}m ${diag.uptime % 60}s`}</span></div>
              <div className="stat-mini"><span className="stat-label">Memory</span><span className="mono">{diag.memoryMB} MB</span></div>
            </div>
          )}

          {diag?.mounts?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Volume Mounts (/mnt)</h4>
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

          <div>
            <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
              <h4>Recent Logs</h4>
              {!logs.length && (
                <button
                  className="btn sm"
                  disabled={logsLoading}
                  onClick={() => { setLogsLoading(true); fetchLogs(200).then(setLogs).catch(console.error).finally(() => setLogsLoading(false)); }}
                >
                  {logsLoading ? 'Loading…' : 'Load Logs'}
                </button>
              )}
            </div>
            {logs.length > 0 && (
              <div style={{
                maxHeight: 320, overflow: 'auto', background: 'var(--bg-main)',
                borderRadius: 6, padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono)',
                lineHeight: 1.6, border: '1px solid var(--border)',
              }}>
                {logs.map((entry, i) => (
                  <div key={i} style={{ color: entry.level === 'error' ? 'var(--red)' : entry.level === 'warn' ? 'var(--orange)' : 'var(--text-secondary)' }}>
                    <span style={{ opacity: 0.4 }}>{entry.ts.slice(11, 19)}</span>{' '}
                    {entry.message}
                  </div>
                ))}
              </div>
            )}
            {logs.length === 0 && !logsLoading && (
              <p className="form-hint">Click "Load Logs" to view recent backend output. Useful for debugging jobs that fail without visible errors.</p>
            )}
          </div>
        </div>
        </div>
      </div>
    </>
  );
}
