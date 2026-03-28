import { useState, useEffect, useCallback, useRef } from 'react';
import Badge from '../components/Badge';
import FilePicker from '../components/FilePicker';
import { fetchDrives, prescanDrive, fetchPrescanResult, createJob, startJob } from '../api';
import { Usb, Zap, HardDrive, Disc, Container, RefreshCw, BarChart3, Search, Camera, Package, FileText, Folder, AlertTriangle, XCircle, Play } from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i ? 1 : 0)} ${units[i]}`;
}

const typeIcons = {
  usb: <Usb size={18} />,
  nvme: <Zap size={18} />,
  sata: <HardDrive size={18} />,
  'disk-image': <Disc size={18} />,
  'docker-volume': <Container size={18} />,
  unknown: <HardDrive size={18} />,
};

export default function Drives() {
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanResults, setScanResults] = useState({}); // path → result
  const [scanning, setScanning] = useState({});       // path → bool
  const [selected, setSelected] = useState(new Set()); // paths selected for job
  const [destDir, setDestDir] = useState('');
  const [creating, setCreating] = useState(false);
  const [picker, setPicker] = useState(false);
  const pollTimers = useRef({});

  const load = useCallback(() => {
    setLoading(true);
    fetchDrives()
      .then(setDrives)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Clean up poll timers on unmount */
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
    };
  }, []);

  const pollPrescan = useCallback((drivePath) => {
    /* Poll progress every 800ms until done */
    const timer = setInterval(async () => {
      try {
        const result = await fetchPrescanResult(drivePath);
        if (result.status === 'done' || result.error) {
          clearInterval(timer);
          delete pollTimers.current[drivePath];
          setScanning((prev) => ({ ...prev, [drivePath]: false }));
          setScanResults((prev) => ({ ...prev, [drivePath]: result }));
        } else {
          /* Update live progress */
          setScanResults((prev) => ({ ...prev, [drivePath]: { ...result, _live: true } }));
        }
      } catch {
        clearInterval(timer);
        delete pollTimers.current[drivePath];
        setScanning((prev) => ({ ...prev, [drivePath]: false }));
      }
    }, 800);
    pollTimers.current[drivePath] = timer;
  }, []);

  const handlePrescan = async (drivePath) => {
    setScanning((prev) => ({ ...prev, [drivePath]: true }));
    setScanResults((prev) => {
      const next = { ...prev };
      delete next[drivePath];
      return next;
    });
    try {
      await prescanDrive(drivePath);
      pollPrescan(drivePath);
    } catch (err) {
      setScanResults((prev) => ({ ...prev, [drivePath]: { error: err.message } }));
      setScanning((prev) => ({ ...prev, [drivePath]: false }));
    }
  };

  const handlePrescanAll = () => {
    for (const drive of drives) {
      if (!scanResults[drive.path] && !scanning[drive.path]) {
        handlePrescan(drive.path);
      }
    }
  };

  const toggleSelect = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleStartJobs = async () => {
    if (!destDir) {
      alert('Please enter a destination directory.');
      return;
    }
    setCreating(true);
    try {
      for (const srcPath of selected) {
        const job = await createJob({
          sourceDir: srcPath,
          destDir,
          mode: 'normal',
          minWidth: 600,
          minHeight: 600,
          minFilesize: 51200,
        });
        await startJob(job.id);
      }
      alert(`Started ${selected.size} job(s) successfully. Check the Jobs page for progress.`);
      setSelected(new Set());
    } catch (err) {
      alert('Error creating jobs: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Drives</h2>
          <p>Pre-scan connected drives to preview photo counts before organizing</p>
        </div>
        <div className="flex gap-8">
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? 'Detecting…' : <><RefreshCw size={14} /> Refresh</>}
          </button>
          <button className="btn primary" onClick={handlePrescanAll} disabled={drives.length === 0}>
            <BarChart3 size={14} /> Scan All
          </button>
        </div>
      </div>

      <div className="page-body">
        {loading && drives.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Search size={32} /></div>
            <h3>Detecting drives…</h3>
          </div>
        ) : drives.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><HardDrive size={32} /></div>
            <h3>No external drives detected</h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
              Connect an external drive or USB device and click Refresh.
            </p>
          </div>
        ) : (
          <>
            <div className="drives-grid">
              {drives.map((drive) => {
                const result = scanResults[drive.path];
                const isScanning = scanning[drive.path];
                const isSelected = selected.has(drive.path);
                const hasImages = result && !result.error && result.imageCount > 0;

                return (
                  <div
                    key={drive.path}
                    className={`card drive-card${isSelected ? ' drive-card-selected' : ''}`}
                    onClick={() => {
                      if (hasImages) toggleSelect(drive.path);
                    }}
                    style={{ cursor: hasImages ? 'pointer' : 'default' }}
                  >
                    <div className="drive-card-header">
                      <div className="flex items-center gap-8">
                        {hasImages && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(drive.path)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                          />
                        )}
                        <span className="drive-icon">{typeIcons[drive.type] || <HardDrive size={18} />}</span>
                        <div>
                          <h3 className="drive-name">{drive.name}</h3>
                          <span className="mono drive-path">{drive.path}</span>
                        </div>
                      </div>
                      <div className="flex gap-8 items-center">
                        {drive.removable && <Badge variant="orange">Removable</Badge>}
                        <Badge variant="cyan">{drive.type}</Badge>
                      </div>
                    </div>

                    <div className="drive-meta">
                      {drive.size && <span>Size: {drive.size}</span>}
                      <span>FS: {drive.filesystem}</span>
                      {drive.protocol !== 'unknown' && <span>Protocol: {drive.protocol}</span>}
                    </div>

                    {/* Pre-scan results area */}
                    <div className="drive-scan-area">
                      {!result && !isScanning && (
                        <button
                          className="btn primary sm"
                          onClick={(e) => { e.stopPropagation(); handlePrescan(drive.path); }}
                        >
                          <Search size={14} /> Pre-scan
                        </button>
                      )}
                      {isScanning && !result && (
                        <div className="drive-scanning">
                          <div className="scan-spinner" />
                          <span>Starting scan…</span>
                        </div>
                      )}
                      {isScanning && result && result._live && (
                        <div className="drive-results">
                          <div className="drive-scanning" style={{ marginBottom: 8 }}>
                            <div className="scan-spinner" />
                            <span>Scanning… {(result.totalFiles || 0).toLocaleString()} files found</span>
                          </div>
                          <div className="drive-result-row">
                            <span className="drive-result-label"><Camera size={14} /> Photos found</span>
                            <span className="drive-result-value mono">{(result.imageCount || 0).toLocaleString()}</span>
                          </div>
                          <div className="drive-result-row">
                            <span className="drive-result-label"><Package size={14} /> Photo size</span>
                            <span className="drive-result-value mono">{formatBytes(result.imageBytes)}</span>
                          </div>
                          {result.currentFile && (
                            <div className="aji-file" style={{ marginTop: 4 }}>
                              {result.currentFile}
                            </div>
                          )}
                        </div>
                      )}
                      {result && !result.error && !result._live && (
                        <div className="drive-results">
                          <div className="drive-result-row">
                            <span className="drive-result-label"><Camera size={14} /> Photos found</span>
                            <span className="drive-result-value mono">{result.imageCount.toLocaleString()}</span>
                          </div>
                          <div className="drive-result-row">
                            <span className="drive-result-label"><Package size={14} /> Photo size</span>
                            <span className="drive-result-value mono">{formatBytes(result.imageBytes)}</span>
                          </div>
                          <div className="drive-result-row">
                            <span className="drive-result-label"><FileText size={14} /> Other files</span>
                            <span className="drive-result-value mono">{result.otherCount.toLocaleString()}</span>
                          </div>
                          <div className="drive-result-row">
                            <span className="drive-result-label"><Folder size={14} /> Total</span>
                            <span className="drive-result-value mono">{result.totalFiles.toLocaleString()} files ({formatBytes(result.totalBytes)})</span>
                          </div>
                          {result.truncated && (
                            <div style={{ color: 'var(--orange)', fontSize: 12, marginTop: 4 }}>
                              <AlertTriangle size={14} /> Scan capped at 500k files — actual count may be higher
                            </div>
                          )}
                          {result.topFolders.length > 0 && (
                            <div className="drive-folders">
                              <span className="drive-result-label">Top folders:</span>
                              <div className="drive-folder-tags">
                                {result.topFolders.slice(0, 10).map((f) => (
                                  <span key={f} className="badge cyan">{f}</span>
                                ))}
                                {result.topFolders.length > 10 && (
                                  <span className="badge accent">+{result.topFolders.length - 10} more</span>
                                )}
                              </div>
                            </div>
                          )}
                          <button
                            className="btn sm"
                            style={{ marginTop: 8 }}
                            onClick={(e) => { e.stopPropagation(); handlePrescan(drive.path); }}
                          >
                            <RefreshCw size={14} /> Re-scan
                          </button>
                        </div>
                      )}
                      {result && result.error && (
                        <div style={{ color: 'var(--red)', fontSize: 13 }}>
                          <XCircle size={14} /> {result.error}
                          <button
                            className="btn sm"
                            style={{ marginLeft: 8 }}
                            onClick={(e) => { e.stopPropagation(); handlePrescan(drive.path); }}
                          >
                            Retry
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action bar — visible when drives are selected */}
            {selected.size > 0 && (
              <div className="card drive-action-bar">
                <div className="flex items-center gap-12" style={{ flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>
                    {selected.size} drive{selected.size > 1 ? 's' : ''} selected
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {(() => {
                      let total = 0;
                      for (const p of selected) {
                        const r = scanResults[p];
                        if (r && !r.error) total += r.imageCount;
                      }
                      return `${total.toLocaleString()} photos total`;
                    })()}
                  </span>
                </div>
                <div className="flex items-center gap-8" style={{ flex: 1, maxWidth: 500, minWidth: 200 }}>
                  <label style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>Destination:</label>
                  <div className="flex gap-8" style={{ flex: 1 }}>
                    <input
                      className="form-input mono"
                      placeholder="/mnt/photos/organized"
                      value={destDir}
                      onChange={(e) => setDestDir(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button className="btn" onClick={() => setPicker(true)}>Browse…</button>
                  </div>
                </div>
                <button
                  className="btn primary"
                  onClick={handleStartJobs}
                  disabled={creating || !destDir}
                >
                  {creating ? 'Creating…' : <><Play size={14} /> Start {selected.size} Job{selected.size > 1 ? 's' : ''}</>}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <FilePicker
        open={picker}
        title="Select Destination Directory"
        onClose={() => setPicker(false)}
        onSelect={(path) => {
          setDestDir(path);
          setPicker(false);
        }}
      />
    </>
  );
}
