import { useState, useEffect, useCallback, useMemo } from 'react';
import Badge from '../components/Badge';
import PillTabs from '../components/PillTabs';
import { fetchDuplicates, fetchDuplicateJobs, resolveDuplicate, deleteDuplicateFile } from '../api';

const resolutionVariant = { keep: 'green', delete: 'red', undecided: 'orange' };

const tabs = [
  { value: '', label: 'All' },
  { value: 'undecided', label: 'Undecided' },
  { value: 'keep', label: 'Kept' },
  { value: 'delete', label: 'Deleted' },
];

const columnDefs = [
  { key: 'src_path',      label: 'Source' },
  { key: 'matched_path',  label: 'Matched With' },
  { key: 'similarity',    label: 'Similarity' },
  { key: 'resolution',    label: 'Resolution',  sortKey: (r) => r.resolution || 'undecided' },
  { key: 'created_at',    label: 'Detected' },
];

function comparator(a, b, key, col) {
  let va, vb;
  if (col?.sortKey) { va = col.sortKey(a); vb = col.sortKey(b); }
  else { va = a[key]; vb = b[key]; }
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
}

const fmtPath = (p) => {
  if (!p) return '—';
  const parts = p.split('/');
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
};

const fmtJobLabel = (job) => {
  const dir = job.source_dir.split('/').pop() || job.source_dir;
  const date = new Date(job.created_at);
  return `${dir} — ${date.toLocaleString()}`;
};

export default function Duplicates() {
  const [duplicates, setDuplicates] = useState([]);
  const [total, setTotal] = useState(0);
  const [resolution, setResolution] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    fetchDuplicateJobs().then(setJobs).catch(console.error);
  }, []);

  const load = useCallback(() => {
    const params = {};
    if (resolution) params.resolution = resolution;
    if (selectedJobId) params.jobId = selectedJobId;
    fetchDuplicates(params).then((d) => { setDuplicates(d.duplicates); setTotal(d.total); }).catch(console.error);
  }, [resolution, selectedJobId]);

  useEffect(() => { load(); }, [load]);

  const sortedDuplicates = useMemo(() => {
    if (!sortCol) return duplicates;
    const col = columnDefs.find((c) => c.key === sortCol);
    const sorted = [...duplicates].sort((a, b) => comparator(a, b, sortCol, col));
    return sortAsc ? sorted : sorted.reverse();
  }, [duplicates, sortCol, sortAsc]);

  const handleSort = (key) => {
    if (sortCol === key) { setSortAsc((p) => !p); }
    else { setSortCol(key); setSortAsc(true); }
  };

  const handleResolve = async (id, res) => {
    await resolveDuplicate(id, res);
    load();
  };

  const handleDelete = async (id) => {
    if (!confirm('Permanently delete this source file from disk?')) return;
    try {
      await deleteDuplicateFile(id);
      load();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const summaryText = resolution
    ? `${total.toLocaleString()} ${resolution} duplicate${total !== 1 ? 's' : ''}`
    : `${total.toLocaleString()} duplicate pair${total !== 1 ? 's' : ''} detected`;

  return (
    <>
      <div className="page-header">
        <h2>Duplicates</h2>
        <p>{summaryText}</p>
      </div>
      <div className="page-body">
        <div className="photos-filter-bar">
          <select
            className="form-select"
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
          >
            <option value="">All Jobs</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{fmtJobLabel(j)}</option>
            ))}
          </select>
          <PillTabs tabs={tabs} active={resolution} onChange={setResolution} />
        </div>

        {sortedDuplicates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <h3>No duplicates found</h3>
            <p>Run a job with dedup enabled to detect duplicate photos.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columnDefs.map((col) => (
                    <th key={col.key} className="sortable-th" onClick={() => handleSort(col.key)}>
                      {col.label}
                      <span className="sort-indicator">
                        {sortCol === col.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                      </span>
                    </th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedDuplicates.map((dup) => {
                  const pct = dup.similarity.toFixed(1);
                  const simVariant = dup.similarity >= 90 ? 'red' : dup.similarity >= 70 ? 'orange' : 'accent';
                  const res = dup.resolution || 'undecided';
                  return (
                    <tr key={dup.id}>
                      <td className="truncate mono" title={dup.src_path}>{fmtPath(dup.src_path)}</td>
                      <td className="truncate mono" title={dup.matched_path}>{fmtPath(dup.matched_path)}</td>
                      <td><Badge variant={simVariant}>{pct}%</Badge></td>
                      <td><Badge variant={resolutionVariant[res]}>{res}</Badge></td>
                      <td>{new Date(dup.created_at).toLocaleString()}</td>
                      <td>
                        <div className="dup-actions">
                          {res !== 'keep' && (
                            <button className="btn sm" onClick={() => handleResolve(dup.id, 'keep')}>Keep</button>
                          )}
                          {res !== 'delete' && (
                            <button className="btn sm danger" onClick={() => handleResolve(dup.id, 'delete')}>Skip</button>
                          )}
                          {res === 'delete' && (
                            <button className="btn sm danger" onClick={() => handleDelete(dup.id)} title="Permanently delete source file">🗑 Delete File</button>
                          )}
                          {res !== 'undecided' && (
                            <button className="btn sm" onClick={() => handleResolve(dup.id, 'undecided')}>Reset</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
