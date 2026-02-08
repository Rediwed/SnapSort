import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Badge from '../components/Badge';
import PillTabs from '../components/PillTabs';
import { fetchPhotos, fetchPhotoJobs, photoPreviewUrl, overridePhotos, resolveDuplicate } from '../api';

const statusVariant = { copied: 'green', skipped: 'orange', error: 'red', pending: 'accent', duplicate: 'red' };
const resolutionVariant = { keep: 'green', delete: 'red', undecided: 'orange' };

const tabs = [
  { value: '',          label: 'All' },
  { value: 'copied',    label: 'Copied' },
  { value: 'skipped',   label: 'Skipped' },
  { value: 'duplicate', label: 'Duplicates' },
  { value: 'error',     label: 'Errors' },
];

const resolutionTabs = [
  { value: '',          label: 'All' },
  { value: 'undecided', label: 'Undecided' },
  { value: 'keep',      label: 'Kept' },
  { value: 'delete',    label: 'Deleted' },
];

const tabLabels = { '': 'all', copied: 'copied', skipped: 'skipped', duplicate: 'duplicate', error: 'error' };

/* System locale date formatting */
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString();
};

const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString();
};

const fmtJobLabel = (job) => {
  const dir = job.source_dir.split('/').pop() || job.source_dir;
  const date = new Date(job.created_at);
  const short = date.toLocaleString();
  return `${dir} — ${short}`;
};

const fmtPath = (p) => {
  if (!p) return '—';
  const parts = p.split('/');
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
};

/* ── Column definitions ──────────────────────────────────────────── */

const baseColumns = [
  { key: 'filename',     label: 'Filename' },
  { key: 'extension',    label: 'Ext' },
  { key: 'status',       label: 'Status' },
  { key: 'skip_reason',  label: 'Reason' },
  { key: 'file_size',    label: 'Size' },
  { key: 'dimensions',   label: 'W×H',         sortKey: (r) => (r.width || 0) * (r.height || 0) },
  { key: 'date_taken',   label: 'Date Taken' },
  { key: 'processed_at', label: 'Processed' },
];

const dupColumns = [
  { key: 'filename',         label: 'Filename' },
  { key: 'extension',        label: 'Ext' },
  { key: 'similarity',       label: 'Similarity',  sortKey: (r) => r.similarity || 0 },
  { key: 'dup_matched_path', label: 'Matched With' },
  { key: 'dup_resolution',   label: 'Resolution',  sortKey: (r) => r.dup_resolution || 'undecided' },
  { key: 'width',            label: 'Width' },
  { key: 'height',           label: 'Height' },
  { key: 'dpi',              label: 'DPI' },
  { key: 'file_size',        label: 'Size' },
  { key: 'date_taken',       label: 'Date Taken' },
  { key: 'processed_at',     label: 'Processed' },
];

function comparator(a, b, key, col) {
  let va, vb;
  if (col?.sortKey) {
    va = col.sortKey(a);
    vb = col.sortKey(b);
  } else {
    va = a[key];
    vb = b[key];
  }
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
}

export default function Photos() {
  const [status, setStatus] = useState('');
  const [resolution, setResolution] = useState('');
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [overriding, setOverriding] = useState(false);

  /* Sort state */
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  /* Hover preview state */
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);

  const isDupTab = status === 'duplicate';
  const columns = isDupTab ? dupColumns : baseColumns;

  /* Load job list for dropdown */
  useEffect(() => {
    fetchPhotoJobs().then(setJobs).catch(console.error);
  }, []);

  /* Reset sort + selection when tab changes */
  useEffect(() => {
    setSortCol(null);
    setSortAsc(true);
    setSelected(new Set());
    if (!isDupTab) setResolution('');
  }, [status]);

  /* Load photos whenever filters change */
  const loadPhotos = useCallback(() => {
    const params = {};
    if (isDupTab) {
      params.isDuplicate = 'true';
      if (resolution) params.resolution = resolution;
    } else if (status) {
      params.status = status;
    }
    if (selectedJobId) params.jobId = selectedJobId;
    fetchPhotos(params).then((d) => {
      setPhotos(d.photos);
      setTotal(d.total);
    }).catch(console.error);
  }, [status, resolution, selectedJobId, isDupTab]);

  useEffect(() => {
    loadPhotos();
    setSelected(new Set());
  }, [loadPhotos]);

  /* Sorted photos (memoised) */
  const sortedPhotos = useMemo(() => {
    if (!sortCol) return photos;
    const col = columns.find((c) => c.key === sortCol);
    const sorted = [...photos].sort((a, b) => comparator(a, b, sortCol, col));
    return sortAsc ? sorted : sorted.reverse();
  }, [photos, sortCol, sortAsc, columns]);

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortCol(key);
      setSortAsc(true);
    }
  };

  /* ── Selection ──────────────────────────────────────────────────── */
  const selectablePhotos = isDupTab
    ? sortedPhotos
    : sortedPhotos.filter((p) => p.status === 'skipped');
  const allSelectableSelected = selectablePhotos.length > 0 && selectablePhotos.every((p) => selected.has(p.id));

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllSelectable = () => {
    if (allSelectableSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectablePhotos.map((p) => p.id)));
    }
  };

  /* Override handler (skipped photos) */
  const handleOverride = async () => {
    if (selected.size === 0) return;
    const selectedPhotos = photos.filter((p) => selected.has(p.id));
    const jobId = selectedPhotos[0]?.job_id;
    if (!jobId || selectedPhotos.some((p) => p.job_id !== jobId)) {
      alert('Please select photos from only one job at a time.');
      return;
    }
    if (!confirm(`Copy ${selected.size} skipped photo${selected.size > 1 ? 's' : ''} anyway?`)) return;
    setOverriding(true);
    try {
      const result = await overridePhotos(jobId, [...selected]);
      setSelected(new Set());
      loadPhotos();
      fetchPhotoJobs().then(setJobs).catch(console.error);
      if (result.errors > 0) {
        alert(`Override complete: ${result.overridden} copied, ${result.errors} failed.`);
      }
    } catch (err) {
      alert(`Override failed: ${err.message}`);
    } finally {
      setOverriding(false);
    }
  };

  /* Resolve handler (duplicates) */
  const handleResolve = async (dupId, res) => {
    await resolveDuplicate(dupId, res);
    loadPhotos();
  };

  /* Bulk resolve handler */
  const handleBulkResolve = async (res) => {
    if (selected.size === 0) return;
    const selectedPhotos = photos.filter((p) => selected.has(p.id) && p.dup_id);
    if (selectedPhotos.length === 0) return;
    if (!confirm(`Mark ${selectedPhotos.length} duplicate${selectedPhotos.length > 1 ? 's' : ''} as "${res}"?`)) return;
    try {
      await Promise.all(selectedPhotos.map((p) => resolveDuplicate(p.dup_id, res)));
      setSelected(new Set());
      loadPhotos();
    } catch (err) {
      alert(`Bulk resolve failed: ${err.message}`);
    }
  };

  /* Hover preview */
  const handleMouseEnter = (e, photo) => {
    setPreview({ id: photo.id, x: e.clientX + 16, y: e.clientY - 60 });
  };

  const handleMouseMove = (e) => {
    setPreview((prev) => prev ? { ...prev, x: e.clientX + 16, y: e.clientY - 60 } : null);
  };

  const handleMouseLeave = () => {
    setPreview(null);
  };

  const label = tabLabels[status] || 'all';
  const summaryText = isDupTab
    ? (resolution
        ? `${total.toLocaleString()} ${resolution} duplicate${total !== 1 ? 's' : ''}`
        : `${total.toLocaleString()} duplicate pair${total !== 1 ? 's' : ''} detected`)
    : (status
        ? `${total.toLocaleString()} ${label} photo${total !== 1 ? 's' : ''}`
        : `${total.toLocaleString()} photo${total !== 1 ? 's' : ''} processed across all jobs`);

  return (
    <>
      <div className="page-header">
        <h2>Photos</h2>
        <p>{summaryText}</p>
      </div>
      <div className="page-body">
        {/* Filter bar: job dropdown left, pill tabs right */}
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
          <PillTabs tabs={tabs} active={status} onChange={setStatus} />
        </div>

        {/* Sub-filter: resolution tabs (visible only on Duplicates pill) */}
        {isDupTab && (
          <div className="photos-filter-bar sub-filter">
            <PillTabs tabs={resolutionTabs} active={resolution} onChange={setResolution} />
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && !isDupTab && (
          <div className="override-bar">
            <span>{selected.size} skipped photo{selected.size > 1 ? 's' : ''} selected</span>
            <button
              className="btn btn-override"
              onClick={handleOverride}
              disabled={overriding}
            >
              {overriding ? 'Copying…' : `Copy ${selected.size} Anyway`}
            </button>
          </div>
        )}

        {selected.size > 0 && isDupTab && (
          <div className="override-bar">
            <span>{selected.size} duplicate{selected.size > 1 ? 's' : ''} selected</span>
            <div className="dup-bulk-actions">
              <button className="btn sm" onClick={() => handleBulkResolve('keep')}>Keep All</button>
              <button className="btn sm danger" onClick={() => handleBulkResolve('delete')}>Ignore All</button>
              <button className="btn sm" onClick={() => handleBulkResolve('undecided')}>Reset All</button>
            </div>
          </div>
        )}

        {/* Table */}
        {photos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{isDupTab ? '✅' : '📭'}</div>
            <h3>{isDupTab ? 'No duplicates found' : 'No photos found'}</h3>
            {isDupTab && <p>Run a job with dedup enabled to detect duplicate photos.</p>}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-check">
                    {selectablePhotos.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allSelectableSelected}
                        onChange={toggleAllSelectable}
                        title={isDupTab ? 'Select all duplicates' : 'Select all skipped photos'}
                      />
                    )}
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="sortable-th"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      <span className="sort-indicator">
                        {sortCol === col.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                      </span>
                    </th>
                  ))}
                  {isDupTab && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sortedPhotos.map((photo) => {
                  const isSelectable = isDupTab || photo.status === 'skipped';
                  return isDupTab
                    ? renderDupRow(photo, selected, toggleOne, handleResolve, handleMouseEnter, handleMouseMove, handleMouseLeave)
                    : renderPhotoRow(photo, selected, toggleOne, isSelectable, handleMouseEnter, handleMouseMove, handleMouseLeave);
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Hover preview tooltip */}
        {preview && (
          <div
            ref={previewRef}
            className="photo-preview-tooltip"
            style={{ left: preview.x, top: preview.y }}
          >
            <img
              src={photoPreviewUrl(preview.id)}
              alt="Preview"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
        )}
      </div>
    </>
  );
}

/* ── Row renderers ────────────────────────────────────────────────── */

function renderPhotoRow(photo, selected, toggleOne, isSelectable, onEnter, onMove, onLeave) {
  return (
    <tr key={photo.id} className={selected.has(photo.id) ? 'row-selected' : ''}>
      <td className="col-check">
        {isSelectable && (
          <input
            type="checkbox"
            checked={selected.has(photo.id)}
            onChange={() => toggleOne(photo.id)}
          />
        )}
      </td>
      <td className="truncate">
        <span
          className="filename-preview"
          onMouseEnter={(e) => onEnter(e, photo)}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        >
          {photo.filename}
        </span>
        {photo.overridden_at && <Badge variant="cyan">overridden</Badge>}
      </td>
      <td className="mono">{photo.extension}</td>
      <td><Badge variant={statusVariant[photo.status] || 'accent'}>{photo.status}</Badge></td>
      <td className="truncate">{photo.skip_reason || '—'}</td>
      <td className="mono">{photo.file_size ? `${(photo.file_size / 1024).toFixed(0)} KB` : '—'}</td>
      <td className="mono">{photo.width ? `${photo.width}×${photo.height}` : '—'}</td>
      <td>{fmtDate(photo.date_taken)}</td>
      <td>{fmtDateTime(photo.processed_at)}</td>
    </tr>
  );
}

function renderDupRow(photo, selected, toggleOne, handleResolve, onEnter, onMove, onLeave) {
  const pct = (photo.similarity || 0).toFixed(1);
  const simVariant = (photo.similarity || 0) >= 90 ? 'red' : (photo.similarity || 0) >= 70 ? 'orange' : 'accent';
  const res = photo.dup_resolution || 'undecided';

  return (
    <tr key={photo.id} className={selected.has(photo.id) ? 'row-selected' : ''}>
      <td className="col-check">
        <input
          type="checkbox"
          checked={selected.has(photo.id)}
          onChange={() => toggleOne(photo.id)}
        />
      </td>
      <td className="truncate">
        <span
          className="filename-preview"
          onMouseEnter={(e) => onEnter(e, photo)}
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        >
          {photo.filename}
        </span>
      </td>
      <td className="mono">{photo.extension}</td>
      <td><Badge variant={simVariant}>{pct}%</Badge></td>
      <td className="truncate mono" title={photo.dup_matched_path}>{fmtPath(photo.dup_matched_path)}</td>
      <td><Badge variant={resolutionVariant[res]}>{res}</Badge></td>
      <td className="mono">{photo.width ?? '—'}</td>
      <td className="mono">{photo.height ?? '—'}</td>
      <td className="mono">{photo.dpi ?? '—'}</td>
      <td className="mono">{photo.file_size ? `${(photo.file_size / 1024).toFixed(0)} KB` : '—'}</td>
      <td>{fmtDate(photo.date_taken)}</td>
      <td>{fmtDateTime(photo.processed_at)}</td>
      <td>
        <div className="dup-actions">
          {res !== 'keep' && (
            <button className="btn sm" onClick={() => handleResolve(photo.dup_id, 'keep')}>Keep</button>
          )}
          {res !== 'delete' && (
            <button className="btn sm danger" onClick={() => handleResolve(photo.dup_id, 'delete')}>Ignore</button>
          )}
          {res !== 'undecided' && (
            <button className="btn sm" onClick={() => handleResolve(photo.dup_id, 'undecided')}>Reset</button>
          )}
        </div>
      </td>
    </tr>
  );
}
