import { useState, useEffect, useRef } from 'react';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import { fetchBenchmarks, fetchBenchmark, startBenchmark } from '../api';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export default function Benchmarks() {
  const [runs, setRuns] = useState([]);
  const [active, setActive] = useState(null);   // full detail of selected run
  const [config, setConfig] = useState({ fileCount: 50, minSize: 51200, maxSize: 5242880 });
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  /* Load list */
  const loadRuns = () => fetchBenchmarks().then(setRuns).catch(console.error);
  useEffect(() => { loadRuns(); }, []);

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
    setStarting(true);
    try {
      const { id } = await startBenchmark(config);
      const detail = await fetchBenchmark(id);
      setActive(detail);
      loadRuns();
    } finally {
      setStarting(false);
    }
  };

  const r = active?.results; // summary object

  const historyColumns = [
    { key: 'id', header: 'ID', className: 'mono', render: (row) => row.id.slice(0, 8) },
    {
      key: 'status', header: 'Status',
      render: (row) => <Badge variant={row.status === 'done' ? 'green' : row.status === 'running' ? 'accent' : 'red'}>{row.status}</Badge>,
    },
    { key: 'files', header: 'Files', className: 'mono', render: (row) => row.config?.fileCount || '—' },
    { key: 'speedup', header: 'Speedup', className: 'mono', render: (row) => row.results ? `${row.results.speedup}×` : '—' },
    { key: 'startedAt', header: 'Started', render: (row) => new Date(row.startedAt).toLocaleString() },
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
          <p>Test hashing performance on your storage</p>
        </div>
        <button className="btn primary" onClick={handleStart} disabled={starting}>
          {starting ? 'Starting…' : '▶ Run Benchmark'}
        </button>
      </div>

      <div className="page-body">
        {/* Config card */}
        <div className="card mb-16">
          <div className="card-header"><h3>Benchmark Configuration</h3></div>
          <div className="flex gap-12">
            <div className="form-group" style={{ flex: 1 }}>
              <label>File Count</label>
              <input className="form-input mono" type="number" value={config.fileCount} onChange={(e) => setConfig({ ...config, fileCount: Number(e.target.value) })} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Min Size (bytes)</label>
              <input className="form-input mono" type="number" value={config.minSize} onChange={(e) => setConfig({ ...config, minSize: Number(e.target.value) })} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Max Size (bytes)</label>
              <input className="form-input mono" type="number" value={config.maxSize} onChange={(e) => setConfig({ ...config, maxSize: Number(e.target.value) })} />
            </div>
          </div>
        </div>

        {/* Active result */}
        {active && (
          <>
            <div className="flex items-center gap-12 mb-16">
              <h3>Run {active.id.slice(0, 8)}</h3>
              <Badge variant={active.status === 'done' ? 'green' : active.status === 'running' ? 'accent' : 'red'}>
                {active.status}
              </Badge>
              {active.status === 'running' && (
                <div className="progress-bar" style={{ width: 200 }}>
                  <div className="progress-fill" style={{ width: '60%' }} />
                </div>
              )}
            </div>

            {r && (
              <>
                <div className="stat-grid">
                  <StatCard label="Files Tested"     value={r.file_count}                              variant="accent" />
                  <StatCard label="Total Data"        value={formatBytes(r.total_bytes)}                variant="cyan" />
                  <StatCard label="Standard Hash"     value={`${r.standard_time}s`}                    variant="orange" sub={`${r.standard_throughput_mbps} MB/s`} />
                  <StatCard label="Fast Hash"         value={`${r.fast_time}s`}                        variant="green"  sub={`${r.fast_throughput_mbps} MB/s`} />
                  <StatCard label="Speedup"           value={`${r.speedup}×`}                          variant="pink" />
                </div>

                <div className="card mb-16">
                  <div className="card-header"><h3>Recommendation</h3></div>
                  <p style={{ fontSize: 14 }}>{r.recommendation}</p>
                  <ul style={{ marginTop: 12, paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 2 }}>
                    <li>Increase <code>FAST_HASH_BYTES</code> to 16384 for NVMe Gen4 SSDs</li>
                    <li>Enable multi-threading for datasets &gt; 1 000 files</li>
                    <li>Use <code>ENABLE_FAST_HASH=True</code> for maximum performance</li>
                  </ul>
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
                  maxHeight: 240, overflowY: 'auto', whiteSpace: 'pre-wrap',
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
    </>
  );
}
