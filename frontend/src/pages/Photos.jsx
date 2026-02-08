import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Badge from '../components/Badge';
import PillTabs from '../components/PillTabs';
import { fetchPhotos, fetchPhotoJobs, photoPreviewUrl, overridePhotos } from '../api';

const statusVariant = { copied: 'green', skipped: 'orange', error: 'red', pending: 'accent' };

const tabs = [
  { value: '', label: 'All' },
  { value: 'copied', label: 'Copied' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'error', label: 'Errors' },
];

const tabLabels = { '': 'all', copied: 'copied', skipped: 'skipped', error: 'error' };

/* System locale date formatting — respects the user's OS/browser settings */
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

/* Column definitions for sortable headers */
const columnDefs = [
  { key: 'filename',     label: 'Filename' },
  { key: 'extension',    label: 'Ext' },
  { key: 'status',       label: 'Status' },
  { key: 'skip_reason',  label: 'Reason' },
  { key: 'file_size',    label: 'Size' },
  { key: 'dimensions',   label: 'W×H',         sortKey: (r) => (r.width || 0) * (r.height || 0) },
  { key: 'date_taken',   label: 'Date Taken' },
  { key: 'processed_at', label: 'Processed' },
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
  /* Nulls / empties always sort last */
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
}

export default function Photos() {
  const [status, setStatus] = useState('');
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [overriding, setOverriding] = useState(false);

  /* Sort state */
  const [sortCol, setSortCol] = useState(null);   // column key
  const [sortAsc, setSortAsc] = useState(true);

  /* Hover preview state */
  const [preview, setPreview] = useState(null); // { id, x, y }
  const previewRef = useRef(null);

  /* Load job list for dropdown */
  useEffect(() => {
    fetchPhotoJobs().then(setJobs).catch(console.error);
  }, []);

  /* Load photos whenever filters change */
  const loadPhotos = useCallback(() => {
    const params = {};
    if (status) params.status = status;
    if (selectedJobId) params.jobId = selectedJobId;
    fetchPhotos(params).then((d) => {
      setPhotos(d.photos);
      setTotal(d.total);
    }).catch(console.error);
  }, [status, selectedJobId]);

  useEffect(() => {
    loadPhotos();
    setSelected(new Set());
  }, [loadPhotos]);

  /* Sorted photos (memoised) */
  const sortedPhotos = useMemo(() => {
    if (!sortCol) return photos;
    const col = columnDefs.find((c) => c.key === sortCol);
    const sorted = [...photos].sort((a, b) => comparator(a, b, sortCol, col));
    return sortAsc ? sorted : sorted.reverse();
  }, [photos, sortCol, sortAsc]);

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortCol(key);
      setSortAsc(true);
    }
  };

  /* Checkbox helpers */
  const skippedPhotos = sortedPhotos.filter((p) => p.status === 'skipped');
  const allSkippedSelected = skippedPhotos.length > 0 && skippedPhotos.every((p) => selected.has(p.id));

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllSkipped = () => {
    if (allSkippedSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(skippedPhotos.map((p) => p.id)));
    }
  };

  /* Override handler */
  const handleOverride = async () => {
    if (selected.size === 0) return;

    /* All selected photos must belong to the same job */
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

  /* Hover preview */
  const handleMouseEnter = (e, photo) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPreview({ id: photo.id, x: rect.right + 12, y: rect.top });
  };

  const handleMouseMove = (e, photo) => {
    setPreview((prev) => prev ? { ...prev, x: e.clientX + 16, y: e.clientY - 60 } : null);
  };

  const handleMouseLeave = () => {
    setPreview(null);
  };

  const label = tabLabels[status] || 'all';
  const summaryText = status
    ? `${total.toLocaleString()} ${label} photo${total !== 1 ? 's' : ''}`
    : `${total.toLocaleString()} photo${total !== 1 ? 's' : ''} processed across all jobs`;

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

        {/* Bulk override bar — visible when skipped photos are selected */}
        {selected.size > 0 && (
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

        {/* Photo table */}
        {photos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <h3>No photos found</h3>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-check">
                    {skippedPhotos.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allSkippedSelected}
                        onChange={toggleAllSkipped}
                        title="Select all skipped photos"
                      />
                    )}
                  </th>
                  {columnDefs.map((col) => (
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
                </tr>
              </thead>
              <tbody>
                {sortedPhotos.map((photo) => (
                  <tr key={photo.id} className={selected.has(photo.id) ? 'row-selected' : ''}>
                    <td className="col-check">
                      {photo.status === 'skipped' && (
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
                        onMouseEnter={(e) => handleMouseEnter(e, photo)}
                        onMouseMove={(e) => handleMouseMove(e, photo)}
                        onMouseLeave={handleMouseLeave}
                      >
                        {photo.filename}
                      </span>
                      {photo.overridden_at && (
                        <Badge variant="cyan" >overridden</Badge>
                      )}
                    </td>
                    <td className="mono">{photo.extension}</td>
                    <td><Badge variant={statusVariant[photo.status] || 'accent'}>{photo.status}</Badge></td>
                    <td className="truncate">{photo.skip_reason || '—'}</td>
                    <td className="mono">{photo.file_size ? `${(photo.file_size / 1024).toFixed(0)} KB` : '—'}</td>
                    <td className="mono">{photo.width ? `${photo.width}×${photo.height}` : '—'}</td>
                    <td>{fmtDate(photo.date_taken)}</td>
                    <td>{fmtDateTime(photo.processed_at)}</td>
                  </tr>
                ))}
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
