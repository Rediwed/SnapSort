import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Badge from '../components/Badge';
import PillTabs from '../components/PillTabs';
import { fetchPhotos, fetchPhotoJobs, photoPreviewUrl, overridePhotos, resolveDuplicate } from '../api';

const statusVariant = { copied: 'green', skipped: 'orange', error: 'red', pending: 'accent', duplicate: 'red' };
const resolutionVariant = { keep_overwrite: 'green', keep_rename: 'cyan', ignore: 'red', undecided: 'orange' };
const resolutionLabel = { keep_overwrite: 'overwrite', keep_rename: 'keep both', ignore: 'skip', undecided: 'undecided' };

const tabs = [
  { value: 'copied',    label: 'Copied' },
  { value: 'skipped',   label: 'Skipped' },
  { value: 'duplicate', label: 'Duplicates' },
  { value: 'error',     label: 'Errors' },
];

const resolutionTabs = [
  { value: '',              label: 'All' },
  { value: 'undecided',     label: 'Undecided' },
  { value: 'keep_overwrite', label: 'Overwrite' },
  { value: 'keep_rename',   label: 'Keep Both' },
  { value: 'ignore',        label: 'Skip' },
];

const tabLabels = { copied: 'copied', skipped: 'skipped', duplicate: 'duplicate', error: 'error' };

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

const fmtSize = (s) => {
  if (!s) return '—';
  if (s >= 1048576) return `${(s / 1048576).toFixed(1)} MB`;
  return `${(s / 1024).toFixed(0)} KB`;
};

/* ── Column definitions (non-dup tabs only) ──────────────────────── */

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

/* Duplicate comparison fields shown side by side */
const compareFields = [
  { key: 'file_size',  matchKey: 'match_file_size',  label: 'Size',       fmt: fmtSize },
  { key: 'width',      matchKey: 'match_width',      label: 'Width',      fmt: (v) => v ?? '—', unit: 'px' },
  { key: 'height',     matchKey: 'match_height',     label: 'Height',     fmt: (v) => v ?? '—', unit: 'px' },
  { key: 'dpi',        matchKey: 'match_dpi',        label: 'DPI',        fmt: (v) => v ?? '—' },
  { key: 'date_taken', matchKey: 'match_date_taken', label: 'Date Taken', fmt: fmtDate },
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

/* Sort key for dup cards */
const dupSortKeys = {
  similarity:     (r) => r.similarity || 0,
  dup_resolution: (r) => r.dup_resolution || 'undecided',
  filename:       (r) => r.filename,
};

export default function Photos() {
  const [status, setStatus] = useState('copied');
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

  /* Dup card sort */
  const [dupSort, setDupSort] = useState('similarity');

  /* Hover preview state */
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);

  /* Shift-click tracking */
  const lastClickedRef = useRef(null);

  const isDupTab = status === 'duplicate';
  const columns = baseColumns;

  /* Load job list for dropdown */
  useEffect(() => {
    fetchPhotoJobs().then(setJobs).catch(console.error);
  }, []);

  /* Reset sort + selection when tab changes */
  useEffect(() => {
    setSortCol(null);
    setSortAsc(true);
    setSelected(new Set());
    lastClickedRef.current = null;
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
    lastClickedRef.current = null;
  }, [loadPhotos]);

  /* Sorted photos (memoised) */
  const sortedPhotos = useMemo(() => {
    if (isDupTab) {
      const fn = dupSortKeys[dupSort] || dupSortKeys.similarity;
      return [...photos].sort((a, b) => {
        const va = fn(a), vb = fn(b);
        if (typeof va === 'number' && typeof vb === 'number') return vb - va; // desc similarity
        return String(va).localeCompare(String(vb));
      });
    }
    if (!sortCol) return photos;
    const col = columns.find((c) => c.key === sortCol);
    const sorted = [...photos].sort((a, b) => comparator(a, b, sortCol, col));
    return sortAsc ? sorted : sorted.reverse();
  }, [photos, sortCol, sortAsc, columns, isDupTab, dupSort]);

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortCol(key);
      setSortAsc(true);
    }
  };

  /* ── Selection with shift-click ────────────────────────────────── */
  const selectablePhotos = isDupTab
    ? sortedPhotos
    : sortedPhotos.filter((p) => p.status === 'skipped');
  const allSelectableSelected = selectablePhotos.length > 0 && selectablePhotos.every((p) => selected.has(p.id));

  const toggleOne = (id, index, e) => {
    if (e?.shiftKey && lastClickedRef.current != null) {
      // Shift-click: range select between last clicked and current
      const lo = Math.min(lastClickedRef.current, index);
      const hi = Math.max(lastClickedRef.current, index);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          next.add(sortedPhotos[i].id);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    }
    lastClickedRef.current = index;
  };

  const toggleAllSelectable = () => {
    if (allSelectableSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectablePhotos.map((p) => p.id)));
    }
    lastClickedRef.current = null;
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

  /* Resolve handler — stages a pending action, requires confirm */
  const [pendingResolve, setPendingResolve] = useState(null); // { dupId, resolution }
  const pendingTimer = useRef(null);

  const stageResolve = (dupId, resolution) => {
    if (pendingResolve?.dupId === dupId && pendingResolve?.resolution === resolution) {
      // Second click = confirm
      clearTimeout(pendingTimer.current);
      setPendingResolve(null);
      resolveDuplicate(dupId, resolution).then(() => loadPhotos());
    } else {
      // First click = stage
      clearTimeout(pendingTimer.current);
      setPendingResolve({ dupId, resolution });
      pendingTimer.current = setTimeout(() => setPendingResolve(null), 3000);
    }
  };

  /* Bulk resolve handler */
  const handleBulkResolve = async (res) => {
    if (selected.size === 0) return;
    const selectedPhotos = photos.filter((p) => selected.has(p.id) && p.dup_id);
    if (selectedPhotos.length === 0) return;
    if (!confirm(`${resolutionLabel[res] || res} ${selectedPhotos.length} duplicate${selectedPhotos.length > 1 ? 's' : ''}?`)) return;
    try {
      await Promise.all(selectedPhotos.map((p) => resolveDuplicate(p.dup_id, res)));
      setSelected(new Set());
      loadPhotos();
    } catch (err) {
      alert(`Bulk resolve failed: ${err.message}`);
    }
  };

  /* Hover preview */
  const handleMouseEnter = (e, photoId) => {
    setPreview({ id: photoId, x: e.clientX + 16, y: e.clientY - 60 });
  };

  const handleMouseMove = (e) => {
    setPreview((prev) => prev ? { ...prev, x: e.clientX + 16, y: e.clientY - 60 } : null);
  };

  const handleMouseLeave = () => {
    setPreview(null);
  };

  const label = tabLabels[status] || status;
  const summaryText = isDupTab
    ? (resolution
        ? `${total.toLocaleString()} ${resolution} duplicate${total !== 1 ? 's' : ''}`
        : `${total.toLocaleString()} duplicate pair${total !== 1 ? 's' : ''} detected`)
    : `${total.toLocaleString()} ${label} photo${total !== 1 ? 's' : ''}`;

  return (
    <>
      <div className="page-header">
        <h2>Photos</h2>
        <p>{summaryText}</p>
      </div>
      <div className="page-body">
        {/* Filter bar: job dropdown, pill tabs, resolution sub-filter */}
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
          {isDupTab && (
            <>
              <PillTabs tabs={resolutionTabs} active={resolution} onChange={setResolution} />
              <select
                className="form-select dup-sort-select"
                value={dupSort}
                onChange={(e) => setDupSort(e.target.value)}
              >
                <option value="similarity">Sort: Similarity</option>
                <option value="filename">Sort: Filename</option>
                <option value="dup_resolution">Sort: Resolution</option>
              </select>
            </>
          )}
        </div>

        {/* Content */}
        {photos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{isDupTab ? '✅' : '📭'}</div>
            <h3>{isDupTab ? 'No duplicates found' : 'No photos found'}</h3>
            {isDupTab && <p>Run a job with dedup enabled to detect duplicate photos.</p>}
          </div>
        ) : isDupTab ? (
          /* ── Duplicate comparison cards ────────────────────────── */
          <div className="dup-card-list">
            {/* Select-all row */}
            <label className="dup-select-all">
              <input
                type="checkbox"
                checked={allSelectableSelected}
                onChange={toggleAllSelectable}
              />
              Select all ({sortedPhotos.length})
              <span className="shift-hint">Hold ⇧ Shift to range-select</span>
            </label>

            {sortedPhotos.map((photo, idx) => {
              const res = photo.dup_resolution || 'undecided';
              const pct = (photo.similarity || 0).toFixed(1);
              const simVariant = (photo.similarity || 0) >= 90 ? 'red' : (photo.similarity || 0) >= 70 ? 'orange' : 'accent';
              const isSelected = selected.has(photo.id);
              return (
                <div key={photo.id} className={`dup-card${isSelected ? ' selected' : ''}`}>
                  {/* Card header */}
                  <div className="dup-card-header">
                    <span className="dup-card-check" role="checkbox" aria-checked={isSelected} onClick={(e) => { e.stopPropagation(); toggleOne(photo.id, idx, e); }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        tabIndex={-1}
                        onChange={() => {}}
                      />
                    </span>
                    <Badge variant={simVariant}>{pct}% similar</Badge>
                    <Badge variant={resolutionVariant[res]}>{resolutionLabel[res] || res}</Badge>
                    <div className="dup-card-actions">
                      {res !== 'ignore' && (
                        <button
                          className={`btn sm${pendingResolve?.dupId === photo.dup_id && pendingResolve?.resolution === 'ignore' ? ' confirming danger' : ' danger'}`}
                          onClick={() => stageResolve(photo.dup_id, 'ignore')}
                          title="Do not copy this file"
                        >
                          {pendingResolve?.dupId === photo.dup_id && pendingResolve?.resolution === 'ignore' ? 'Confirm?' : 'Skip'}
                        </button>
                      )}
                      {res !== 'keep_overwrite' && (
                        <button
                          className={`btn sm${pendingResolve?.dupId === photo.dup_id && pendingResolve?.resolution === 'keep_overwrite' ? ' confirming' : ''}`}
                          onClick={() => stageResolve(photo.dup_id, 'keep_overwrite')}
                          title="Copy and replace the existing file"
                        >
                          {pendingResolve?.dupId === photo.dup_id && pendingResolve?.resolution === 'keep_overwrite' ? 'Confirm?' : 'Overwrite'}
                        </button>
                      )}
                      {res !== 'keep_rename' && (
                        <button
                          className={`btn sm${pendingResolve?.dupId === photo.dup_id && pendingResolve?.resolution === 'keep_rename' ? ' confirming' : ''}`}
                          onClick={() => stageResolve(photo.dup_id, 'keep_rename')}
                          title="Copy alongside with a renamed filename"
                        >
                          {pendingResolve?.dupId === photo.dup_id && pendingResolve?.resolution === 'keep_rename' ? 'Confirm?' : 'Keep Both'}
                        </button>
                      )}
                      {res !== 'undecided' && (
                        <button
                          className={`btn sm${pendingResolve?.dupId === photo.dup_id && pendingResolve?.resolution === 'undecided' ? ' confirming' : ''}`}
                          onClick={() => stageResolve(photo.dup_id, 'undecided')}
                        >
                          {pendingResolve?.dupId === photo.dup_id && pendingResolve?.resolution === 'undecided' ? 'Confirm?' : 'Reset'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Side-by-side comparison */}
                  <div className="dup-compare">
                    {/* ── Source (incoming) photo ── */}
                    <div className="dup-side source">
                      <div className="dup-side-label">📥 Source (incoming)</div>
                      <div className="dup-side-file">
                        <span
                          className="filename-preview"
                          title={photo.filename}
                          onMouseEnter={(e) => handleMouseEnter(e, photo.id)}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={handleMouseLeave}
                        >
                          {photo.filename}
                        </span>
                      </div>
                      <div className="dup-side-path mono" title={photo.src_path}>{fmtPath(photo.src_path)}</div>
                    </div>

                    {/* ── Matched (existing/destination) photo ── */}
                    <div className="dup-side match">
                      <div className="dup-side-label">📁 Already in library</div>
                      <div className="dup-side-file">
                        {photo.matched_photo_id ? (
                          <span
                            className="filename-preview"
                            title={photo.match_filename || ''}
                            onMouseEnter={(e) => handleMouseEnter(e, photo.matched_photo_id)}
                            onMouseMove={handleMouseMove}
                            onMouseLeave={handleMouseLeave}
                          >
                            {photo.match_filename || 'matched photo'}
                          </span>
                        ) : (
                          <span className="mono">{fmtPath(photo.dup_matched_path)}</span>
                        )}
                      </div>
                      <div className="dup-side-path mono" title={photo.match_dest_path || photo.dup_matched_path}>
                        {fmtPath(photo.match_dest_path || photo.dup_matched_path)}
                      </div>
                    </div>
                  </div>

                  {/* ── Metadata comparison grid ── */}
                  <div className="dup-meta-grid">
                    <div className="dup-meta-header">
                      <span>Property</span>
                      <span>Source</span>
                      <span>Library</span>
                      <span></span>
                    </div>
                    {compareFields.map((f) => {
                      const srcVal = photo[f.key];
                      const matchVal = photo[f.matchKey];
                      const srcFmt = f.fmt(srcVal);
                      const matchFmt = f.fmt(matchVal);
                      const bothExist = srcVal != null && matchVal != null;
                      const isMatch = bothExist && String(srcFmt) === String(matchFmt);
                      const isMissing = srcVal == null && matchVal == null;
                      return (
                        <div key={f.key} className={`dup-meta-row${isMatch ? ' match' : isMissing ? '' : ' differ'}`}>
                          <span className="dup-meta-label">{f.label}</span>
                          <span className="dup-meta-val mono">{srcFmt}{f.unit && srcVal != null ? ` ${f.unit}` : ''}</span>
                          <span className="dup-meta-val mono">{matchFmt}{f.unit && matchVal != null ? ` ${f.unit}` : ''}</span>
                          <span className="dup-meta-icon">
                            {isMissing ? '—' : isMatch ? '✓' : '✗'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Standard photo table ────────────────────────────── */
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
                        title="Select all skipped photos"
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
                </tr>
              </thead>
              <tbody>
                {sortedPhotos.map((photo, idx) => {
                  const isSelectable = photo.status === 'skipped';
                  return (
                    <tr key={photo.id} className={selected.has(photo.id) ? 'row-selected' : ''}>
                      <td className="col-check">
                        {isSelectable && (
                          <input
                            type="checkbox"
                            checked={selected.has(photo.id)}
                            onChange={(e) => toggleOne(photo.id, idx, e)}
                          />
                        )}
                      </td>
                      <td className="truncate">
                        <span
                          className="filename-preview"
                          title={photo.filename}
                          onMouseEnter={(e) => handleMouseEnter(e, photo.id)}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={handleMouseLeave}
                        >
                          {photo.filename}
                        </span>
                        {photo.overridden_at && <Badge variant="cyan">overridden</Badge>}
                      </td>
                      <td className="mono">{photo.extension}</td>
                      <td><Badge variant={statusVariant[photo.status] || 'accent'}>{photo.status}</Badge></td>
                      <td className="truncate">{photo.skip_reason || '—'}</td>
                      <td className="mono">{fmtSize(photo.file_size)}</td>
                      <td className="mono">{photo.width ? `${photo.width}×${photo.height}` : '—'}</td>
                      <td>{fmtDate(photo.date_taken)}</td>
                      <td>{fmtDateTime(photo.processed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Bulk action bar — sticky at bottom */}
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
              <button className="btn sm danger" onClick={() => handleBulkResolve('ignore')}>Skip All</button>
              <button className="btn sm" onClick={() => handleBulkResolve('keep_overwrite')}>Overwrite All</button>
              <button className="btn sm" onClick={() => handleBulkResolve('keep_rename')}>Keep Both All</button>
              <button className="btn sm" onClick={() => handleBulkResolve('undecided')}>Reset All</button>
            </div>
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
