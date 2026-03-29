import { useState, useEffect, useRef } from 'react';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import FilePicker from '../components/FilePicker';
import { fetchBenchmarks, fetchBenchmark, startBenchmark, fetchProfiles, updateSettings } from '../api';
import { Play, AlertTriangle, BookOpen, HardDrive, Cpu, Zap, RefreshCw, Disc } from 'lucide-react';
import { useSettings } from '../SettingsContext';
import { fmtDateTime } from '../dateFormat';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/* Profile tier order (best → worst) for display sorting */
const PROFILE_ORDER = ['nvme_gen4', 'nvme_gen3', 'sata_ssd', 'hdd_7200rpm', 'hdd_5400rpm', 'usb_external', 'default'];

export default function Benchmarks() {
  const settings = useSettings();
  const [runs, setRuns] = useState([]);
  const [active, setActive] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [config, setConfig] = useState({
    sourcePath: '',
    destPath: '',
    fileCount: 20,
    fileSizeMB: 5,
  });
  const [starting, setStarting] = useState(false);
  const [applied, setApplied] = useState(null); // id of applied profile
  const [picker, setPicker] = useState(null); // 'source' | 'dest' | null
  const pollRef = useRef(null);

  /* Same-path guard */
  const pathsMatch = config.sourcePath && config.destPath
    && config.sourcePath.replace(/\/+$/, '') === config.destPath.replace(/\/+$/, '');

  /* Load list + profiles */
  const loadRuns = () => fetchBenchmarks().then(setRuns).catch(console.error);
  useEffect(() => {
    loadRuns();
    fetchProfiles().then(setProfiles).catch(console.error);
  }, []);

  /* Poll active run while it's running */
  useEffect(() => {
    if (!active || active.status !== 'running') {
      clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const updated = await fetchBenchmark(active.id);
        setActive(updated);
        if (updated.status !== 'running') {
          clearInterval(pollRef.current);
          loadRuns();
        }
      } catch { /* ignore */ }
    }, 1000);
    return () => clearInterval(pollRef.current);
  }, [active?.id, active?.status]);

  /* Start a benchmark */
  const handleStart = async () => {
    if (!config.sourcePath || !config.destPath || pathsMatch) return;
    setStarting(true);
    setApplied(null);
    try {
      const { id } = await startBenchmark(config);
      const detail = await fetchBenchmark(id);
      setActive(detail);
      loadRuns();
    } finally {
      setStarting(false);
    }
  };

  /* Apply a profile as global defaults */
  const applyProfile = async (profile) => {
    try {
      await updateSettings({
        enable_multithreading: profile.enable_multithreading ? 'true' : 'false',
        max_worker_threads: String(profile.max_workers),
        parallel_hash_workers: String(profile.max_workers),
        batch_size: String(profile.batch_size),
        fast_hash_bytes: String(profile.hash_bytes),
        concurrent_copies: String(profile.concurrent_copies),
        sequential_processing: profile.sequential_processing ? 'true' : 'false',
        default_performance_profile: profile.id,
      });
      setApplied(profile.id);
    } catch (err) {
      console.error('Failed to apply profile:', err);
    }
  };

  const r = active?.results;
  const suggestedId = r?.suggested_profile;

  /* Sort profiles: suggested first, then by tier order */
  const sortedProfiles = [...profiles].sort((a, b) => {
    if (a.id === suggestedId) return -1;
    if (b.id === suggestedId) return 1;
    return PROFILE_ORDER.indexOf(a.id) - PROFILE_ORDER.indexOf(b.id);
  });

  /* Which phase is currently running? */
  const runningPhase = active?.status === 'running'
    ? (active.output || []).reduce((last, line) => {
        try { const e = JSON.parse(line); if (e.phase) return e.phase; } catch {}
        return last;
      }, 'setup')
    : null;

  const phaseLabel = {
    setup: 'Creating test files…',
    source_write: 'Writing to source…',
    source_read: 'Reading from source…',
    dest_write: 'Writing to destination…',
    copy: 'Copying source → destination…',
    hash_single: 'Hashing (single-thread)…',
    hash_parallel: 'Hashing (multi-core)…',
  };

  const historyColumns = [
    { key: 'id', header: 'ID', className: 'mono', render: (row) => row.id.slice(0, 8) },
    {
      key: 'status', header: 'Status',
      render: (row) => <Badge variant={row.status === 'done' ? 'green' : row.status === 'running' ? 'accent' : 'red'}>{row.status}</Badge>,
    },
    { key: 'throughput', header: 'Copy MB/s', className: 'mono', render: (row) => row.results ? `${row.results.copy_mbps}` : '—' },
    { key: 'profile', header: 'Suggested', render: (row) => row.results ? row.results.suggested_profile : '—' },
    { key: 'startedAt', header: 'Started', render: (row) => fmtDateTime(row.startedAt, settings) },
    {
      key: 'view', header: '',
      render: (row) => (
        <button className="btn sm" onClick={async () => { const d = await fetchBenchmark(row.id); setActive(d); }}>
          View
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Benchmarks</h2>
          <p>Test real storage speed to find the best performance profile</p>
        </div>
        <button
          className="btn primary"
          onClick={handleStart}
          disabled={starting || !config.sourcePath || !config.destPath || pathsMatch}
        >
          {starting ? 'Running…' : <><Play size={14} /> Run Benchmark</>}
        </button>
      </div>

      <div className="page-body">
        {/* ---- Configuration ---- */}
        <div className="card mb-16">
          <div className="card-header"><h3>Storage Paths</h3></div>
          <div className="bench-paths">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Source Folder</label>
              <div className="flex gap-8">
                <input
                  className="form-input mono"
                  readOnly
                  value={config.sourcePath}
                  placeholder="Select source folder…"
                  onClick={() => setPicker('source')}
                  style={{ cursor: 'pointer' }}
                />
                <button className="btn" onClick={() => setPicker('source')}>Browse</button>
              </div>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Destination Folder</label>
              <div className="flex gap-8">
                <input
                  className="form-input mono"
                  readOnly
                  value={config.destPath}
                  placeholder="Select destination folder…"
                  onClick={() => setPicker('dest')}
                  style={{ cursor: 'pointer' }}
                />
                <button className="btn" onClick={() => setPicker('dest')}>Browse</button>
              </div>
            </div>
          </div>

          {pathsMatch && (
            <div style={{ padding: '8px 12px', background: 'var(--red-muted)', borderRadius: 'var(--radius-md)', color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>
              Source and destination must be different folders.
            </div>
          )}

          <div style={{ padding: '8px 12px', background: 'var(--orange-muted, rgba(210,153,34,0.1))', borderRadius: 'var(--radius-md)', color: 'var(--orange)', fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
                        <AlertTriangle size={14} /> Temporary test files will be written to <strong>both</strong> source and destination folders during the benchmark, then automatically deleted afterwards. Do not use this on a source drive that is malfunctioning or at risk of data loss.
          </div>

          <div className="bench-options">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Test Files</label>
              <input
                className="form-input mono"
                type="number"
                min={1}
                max={200}
                value={config.fileCount}
                onChange={(e) => setConfig({ ...config, fileCount: Number(e.target.value) })}
              />
              <span className="form-hint">Number of files to create</span>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>File Size (MB)</label>
              <input
                className="form-input mono"
                type="number"
                min={1}
                max={100}
                value={config.fileSizeMB}
                onChange={(e) => setConfig({ ...config, fileSizeMB: Number(e.target.value) })}
              />
              <span className="form-hint">Size of each test file</span>
            </div>
            <div className="form-group" style={{ flex: 1, display: 'flex', alignItems: 'flex-end' }}>
              <span className="form-hint" style={{ margin: 0 }}>
                Total: {formatBytes(config.fileCount * config.fileSizeMB * 1024 * 1024)}
              </span>
            </div>
          </div>
        </div>

        {/* ---- Active run status ---- */}
        {active && (
          <>
            <div className="flex items-center gap-12 mb-16" style={{ flexWrap: 'wrap' }}>
              <h3>Run {active.id.slice(0, 8)}</h3>
              <Badge variant={active.status === 'done' ? 'green' : active.status === 'running' ? 'accent' : 'red'}>
                {active.status}
              </Badge>
              {runningPhase && (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {phaseLabel[runningPhase] || runningPhase}
                </span>
              )}
            </div>

            {r && (
              <>
                {/* Throughput stats */}
                <div className="stat-grid">
                  <StatCard label="Source Read"    value={`${r.source_read_mbps} MB/s`}    variant="cyan" />
                  <StatCard label="Dest Write"     value={`${r.dest_write_mbps} MB/s`}     variant="accent" />
                  <StatCard label="Copy Speed"     value={`${r.copy_mbps} MB/s`}           variant="green" sub="Source → Destination" />
                  <StatCard label="Hash (parallel)" value={`${r.hash_parallel_mbps} MB/s`} variant="pink" sub={`${r.hash_workers} workers · ${r.parallel_speedup}× vs single-thread`} />
                  <StatCard label="Data Tested"    value={formatBytes(r.total_bytes)}       variant="orange" sub={`${r.file_count} × ${r.file_size_mb} MB · ${r.cpu_count} CPU cores`} />
                </div>

                {/* ---- Bottleneck analysis ---- */}
                <div className="card mb-16">
                  <div className="card-header"><h3>Analysis</h3></div>
                  <div className="bench-bottleneck">
                    <div className="bench-bottleneck-result">
                      <span className="bench-bottleneck-label">Bottleneck</span>
                      <Badge variant={r.bottleneck === 'cpu' ? 'pink' : r.bottleneck === 'source' ? 'cyan' : 'accent'}>
                        {r.bottleneck === 'source' ? <><BookOpen size={14} /> Source Volume</> : r.bottleneck === 'destination' ? <><HardDrive size={14} /> Destination Volume</> : <><Cpu size={14} /> CPU / Hashing</>}
                      </Badge>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
                      {r.bottleneck === 'source'
                        ? `Source read speed (${r.source_read_mbps} MB/s) is the limiting factor. The destination can write faster than the source can deliver data. Consider a faster source drive or sequential I/O to avoid thrashing.`
                        : r.bottleneck === 'destination'
                        ? `Destination write speed (${r.dest_write_mbps} MB/s) is the limiting factor. The source can read faster than the destination can accept data. Limiting concurrent copies prevents overwhelming the destination.`
                        : `CPU hashing speed (${r.hash_parallel_mbps} MB/s with ${r.hash_workers} workers) is the limiting factor. Both drives are faster than hashing can process. Enabling fast hash and adding workers will help most.`}
                    </p>
                    <div className="bench-bottleneck-bars">
                      {[
                        { label: 'Source Read', value: r.source_read_mbps, color: 'var(--cyan)' },
                        { label: 'Dest Write', value: r.dest_write_mbps, color: 'var(--accent)' },
                        { label: `Hash (${r.hash_workers}w)`, value: r.hash_parallel_mbps, color: 'var(--pink)' },
                      ].map(({ label, value, color }) => {
                        const max = Math.max(r.source_read_mbps, r.dest_write_mbps, r.hash_parallel_mbps);
                        return (
                          <div key={label} className="bench-bar-row">
                            <span className="bench-bar-label">{label}</span>
                            <div className="bench-bar-track">
                              <div className="bench-bar-fill" style={{ width: `${(value / max) * 100}%`, background: color }} />
                            </div>
                            <span className="bench-bar-value">{value} MB/s</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* ---- Profile Suggestion ---- */}
                <div className="card mb-16">
                  <div className="card-header">
                    <h3>Profile Recommendation</h3>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    Profile is tuned for the <strong>slowest storage</strong> in the chain
                    ({Math.min(r.source_read_mbps, r.dest_write_mbps)} MB/s).
                    If either volume is a slow drive, SnapSort throttles parallelism to avoid
                    thrashing — the bottleneck sets the pace for the entire job.
                  </p>

                  <div className="bench-profiles">
                    {sortedProfiles.filter(p => p.id !== 'default').map((profile) => {
                      const isSuggested = profile.id === suggestedId;
                      const isApplied = profile.id === applied;
                      return (
                        <div
                          key={profile.id}
                          className={`bench-profile-card${isSuggested ? ' suggested' : ''}`}
                        >
                          {isSuggested && <div className="bench-profile-badge">★ Recommended</div>}
                          <div className="bench-profile-name">{profile.name}</div>
                          <div className="bench-profile-desc">{profile.description}</div>
                          <div className="profile-summary">
                            {profile.enable_multithreading
                              ? <span className="tag green"><Zap size={14} /> Multi-threaded</span>
                              : <span className="tag orange"><RefreshCw size={14} /> Sequential</span>}
                            <span className="tag accent">{profile.max_workers} Workers</span>
                            <span className="tag cyan">Batch {profile.batch_size}</span>
                            {profile.sequential_processing ? <span className="tag orange"><Disc size={14} /> Sequential I/O</span> : null}
                          </div>
                          <button
                            className={`btn sm ${isSuggested ? 'primary' : ''}`}
                            style={{ marginTop: 10, width: '100%' }}
                            onClick={() => applyProfile(profile)}
                            disabled={isApplied}
                          >
                            {isApplied ? '✓ Applied' : 'Apply Profile'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Raw output log */}
            {active.output && active.output.length > 0 && (
              <div className="card mb-16">
                <div className="card-header"><h3>Output Log</h3></div>
                <pre style={{
                  background: 'var(--bg-root)', padding: 14, borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)',
                  maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap',
                }}>
                  {active.output.join('\n')}
                </pre>
              </div>
            )}
          </>
        )}

        {/* History */}
        <div className="card">
          <div className="card-header"><h3>Benchmark History</h3></div>
          <DataTable columns={historyColumns} rows={runs} emptyMessage="No benchmarks run yet" />
        </div>
      </div>

      {/* FilePicker modals */}
      <FilePicker
        open={picker === 'source'}
        title="Select Source Folder"
        onSelect={(path) => { setConfig({ ...config, sourcePath: path }); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <FilePicker
        open={picker === 'dest'}
        title="Select Destination Folder"
        onSelect={(path) => { setConfig({ ...config, destPath: path }); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
    </>
  );
}
