import { useState, useEffect } from 'react';
import { fetchSettings, updateSettings } from '../api';

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
  { key: 'fast_hash_bytes',        label: 'Fast Hash Sample (bytes)',   type: 'number' },
  { key: 'enable_fast_hash',       label: 'Enable Fast Hashing',       type: 'toggle' },
  { key: 'enable_csv_log',         label: 'Enable CSV Logging',        type: 'toggle' },
];

export default function Settings() {
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState(false);
  const [newExt, setNewExt] = useState('');

  useEffect(() => {
    fetchSettings().then(setValues).catch(console.error);
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

  /* Threading helpers */
  const threadingEnabled = values.enable_multithreading === 'true';
  const maxWorkers = Number(values.max_worker_threads) || 8;
  const hashWorkers = Number(values.parallel_hash_workers) || 4;
  const cpuCount = navigator.hardwareConcurrency || 4;

  return (
    <>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Settings</h2>
          <p>Configure the SnapSort engine defaults</p>
        </div>
        <button className="btn primary" onClick={handleSave}>
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>

      <div className="page-body">
        {/* ── Filter & Quality ─────────────────────────────── */}
        <div className="card" style={{ maxWidth: 600 }}>
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

        {/* ── Performance / Multi-threading ────────────────── */}
        <div className="card" style={{ maxWidth: 600, marginTop: 20 }}>
          <div className="card-header"><h3>Performance</h3></div>

          <div className="form-group">
            <label className="form-toggle">
              <input
                type="checkbox"
                checked={threadingEnabled}
                onChange={(e) => handleChange('enable_multithreading', e.target.checked ? 'true' : 'false')}
              />
              <span>Enable Multi-threading</span>
            </label>
            <p className="form-hint">
              Use parallel workers to process photos concurrently. Best on SSDs.
            </p>
          </div>

          {threadingEnabled && (
            <>
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
            </>
          )}
        </div>

        {/* ── File Formats ─────────────────────────────────── */}
        <div className="card" style={{ maxWidth: 600, marginTop: 20 }}>
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
      </div>
    </>
  );
}
