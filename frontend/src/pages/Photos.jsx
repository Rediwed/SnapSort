import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSettings } from '../SettingsContext';
import { fmtDate, fmtDateTime } from '../dateFormat';
import Badge from '../components/Badge';
import PillTabs from '../components/PillTabs';
import PhotoDetailModal from '../components/PhotoDetailModal';
import { fetchPhotos, fetchPhotoJobs, photoPreviewUrl, overridePhotos, resolveDuplicate } from '../api';
import { CircleCheck, Inbox, Info, Download, Folder, ChevronLeft, ChevronRight, Search } from 'lucide-react';

const statusVariant = { copied: 'green', skipped: 'orange', error: 'red', pending: 'accent', duplicate: 'red', scanned: 'cyan' };
const resolutionVariant = { keep_overwrite: 'green', keep_rename: 'cyan', ignore: 'red', undecided: 'orange' };
const resolutionLabel = { keep_overwrite: 'overwrite', keep_rename: 'keep both', ignore: 'skip', undecided: 'undecided' };

const tabs = [
  { value: 'copied',    label: 'Copied' },
  { value: 'skipped',   label: 'Skipped' },
  { value: 'scanned',   label: 'Scanned' },
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

const tabLabels = { copied: 'copied', skipped: 'skipped', scanned: 'scanned', duplicate: 'duplicate', error: 'error' };

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

/* Generate page number buttons with ellipsis for large ranges */
function generatePageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…');
    result.push(sorted[i]);
  }
  return result;
}

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
  const settings = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState('copied');

  const fmtJobLabel = (job) => {
    const dir = job.source_dir.split('/').pop() || job.source_dir;
    const short = fmtDateTime(job.created_at, settings);
    return `${dir} — ${short}`;
  };
  const [resolution, setResolution] = useState('');
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(searchParams.get('jobId') || '');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTimer = useRef(null);
  const [selected, setSelected] = useState(new Set());
  const [overriding, setOverriding] = useState(false);

  /* Pagination state */
  const [page, setPageRaw] = useState(() => {
    const p = Number(searchParams.get('page'));
    return p >= 1 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const s = Number(searchParams.get('pageSize'));
    return [25, 50, 100, 200].includes(s) ? s : 50;
  });
  const setPage = useCallback((v) => {
    setPageRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      setSearchParams((sp) => {
        const p = new URLSearchParams(sp);
        if (next <= 1) p.delete('page'); else p.set('page', String(next));
        return p;
      }, { replace: true });
      return next;
    });
  }, [setSearchParams]);

  /* Sort state */
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  /* Dup card sort */
  const [dupSort, setDupSort] = useState('similarity');

  /* Hover preview state */
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);

  /* Detail modal state */
  const [detailPhoto, setDetailPhoto] = useState(null);

  /* Shift-click tracking */
  const lastClickedRef = useRef(null);

  const isDupTab = status === 'duplicate';
  const isScannedTab = status === 'scanned';
  const columns = (status === 'copied' || status === 'scanned')
    ? baseColumns.filter((c) => c.key !== 'skip_reason')
    : baseColumns;

  /* Debounced search */
  const handleSearchChange = (val) => {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 300);
  };

  const isValidRegex = useMemo(() => {
    if (!searchInput) return true;
    try { new RegExp(searchInput); return true; } catch { return false; }
  }, [searchInput]);

  /* Load job list for dropdown */
  useEffect(() => {
    fetchPhotoJobs().then(setJobs).catch(console.error);
  }, []);

  /* Reset sort + selection + page when tab changes */
  useEffect(() => {
    setSortCol(null);
    setSortAsc(true);
    setSelected(new Set());
    lastClickedRef.current = null;
    setPage(1);
    if (!isDupTab) setResolution('');
  }, [status]);

  /* Load photos whenever filters or page change */
  const loadPhotos = useCallback(() => {
    const params = {
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    };
    if (isDupTab) {
      params.isDuplicate = 'true';
      if (resolution) params.resolution = resolution;
    } else if (status) {
      params.status = status;
    }
    if (selectedJobId) params.jobId = selectedJobId;
    if (search) params.search = search;
    fetchPhotos(params).then((d) => {
      setPhotos(d.photos);
      setTotal(d.total);
    }).catch(console.error);
  }, [status, resolution, selectedJobId, isDupTab, page, pageSize, search]);

  useEffect(() => {
    loadPhotos();
    setSelected(new Set());
    lastClickedRef.current = null;
  }, [loadPhotos]);

  /* Reset page when filters change (but not page itself) */
  useEffect(() => {
    setPage(1);
  }, [resolution, selectedJobId, search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
    : isScannedTab
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

  /* Override handler (skipped or scanned photos) */
  const handleOverride = async () => {
    if (selected.size === 0) return;
    const selectedPhotos = photos.filter((p) => selected.has(p.id));
    const jobId = selectedPhotos[0]?.job_id;
    if (!jobId || selectedPhotos.some((p) => p.job_id !== jobId)) {
      alert('Please select photos from only one job at a time.');
      return;
    }
    const isScanned = selectedPhotos[0]?.status === 'scanned';
    const label = isScanned ? 'scanned' : 'skipped';
    if (!confirm(`Copy ${selected.size} ${label} photo${selected.size > 1 ? 's' : ''} to destination?`)) return;
    setOverriding(true);
    try {
      const result = await overridePhotos(jobId, [...selected]);
      setSelected(new Set());
      loadPhotos();
      fetchPhotoJobs().then(setJobs).catch(console.error);
      if (result.errors > 0) {
        alert(`Copy complete: ${result.overridden} copied, ${result.errors} failed.`);
      }
    } catch (err) {
      alert(`Copy failed: ${err.message}`);
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
          <div className={`search-box${!isValidRegex ? ' invalid' : ''}`}>
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Regex search filenames…"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              spellCheck={false}
            />
            {searchInput && (
              <button className="search-clear" onClick={() => { setSearchInput(''); setSearch(''); }}>×</button>
            )}
          </div>
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
            <div className="empty-icon">{isDupTab ? <CircleCheck size={32} /> : <Inbox size={32} />}</div>
            <h3>{isDupTab ? 'No duplicates found' : isScannedTab ? 'No scanned photos' : 'No photos found'}</h3>
            {isDupTab && <p>Run a job with dedup enabled to detect duplicate photos.</p>}
            {isScannedTab && <p>Create a job in scan mode to preview photos without copying.</p>}
          </div>
        ) : isDupTab ? (
          /* ── Duplicate comparison cards ────────────────────────── */
          <div className="dup-card-list">
            {/* Source-safety notice */}
            <div className="dup-notice">
              <strong><Info size={14} style={{ verticalAlign: 'middle' }} /> Note:</strong> Resolutions apply to the <em>destination</em> only — source files are never modified. <strong>Overwrite</strong> copies the source over the matched destination file. <strong>Keep Both</strong> copies the source alongside it with a unique name. <strong>Skip</strong> leaves the destination as-is.
            </div>
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
                      <div className="dup-side-label"><Download size={14} /> Source (incoming)</div>
                      <div className="dup-side-file">
                        <span
                          className="filename-preview clickable"
                          title={photo.filename}
                          onClick={() => setDetailPhoto(photo)}
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
                      <div className="dup-side-label"><Folder size={14} /> Already in library</div>
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
                        title={isScannedTab ? 'Select all scanned photos' : 'Select all skipped photos'}
                      />
                    )}
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`sortable-th col-${col.key}`}
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
                  const isSelectable = photo.status === 'skipped' || photo.status === 'scanned';
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
                      <td className="truncate col-filename">
                        <span
                          className="filename-preview clickable"
                          title={photo.filename}
                          onClick={() => setDetailPhoto(photo)}
                          onMouseEnter={(e) => handleMouseEnter(e, photo.id)}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={handleMouseLeave}
                        >
                          {photo.filename?.replace(/\.[^.]+$/, '') || photo.filename}
                        </span>
                        {photo.overridden_at && <Badge variant="cyan">overridden</Badge>}
                      </td>
                      <td className="mono col-extension">{photo.extension}</td>
                      <td className="col-status"><Badge variant={statusVariant[photo.status] || 'accent'}>{photo.status}</Badge></td>
                      {status !== 'copied' && <td className="truncate col-skip_reason">{photo.skip_reason || '—'}</td>}
                      <td className="mono col-file_size">{fmtSize(photo.file_size)}</td>
                      <td className="mono col-dimensions">{photo.width ? `${photo.width}×${photo.height}` : '—'}</td>
                      <td className="col-date_taken">{fmtDate(photo.date_taken, settings)}</td>
                      <td className="col-processed_at">{fmtDateTime(photo.processed_at, settings)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Bulk action bar — sticky at bottom */}
        {selected.size > 0 && !isDupTab && !isScannedTab && (
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

        {selected.size > 0 && isScannedTab && (
          <div className="override-bar">
            <span>{selected.size} scanned photo{selected.size > 1 ? 's' : ''} selected</span>
            <button
              className="btn btn-override"
              onClick={handleOverride}
              disabled={overriding}
            >
              {overriding ? 'Copying…' : `Copy ${selected.size} to Destination`}
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

        {/* Pagination controls */}
        {total > pageSize && (
          <div className="pagination-bar">
            <div className="pagination-info">
              Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
            </div>
            <div className="pagination-controls">
              <button
                className="btn sm"
                disabled={page <= 1}
                onClick={() => setPage(1)}
                title="First page"
              >
                1
              </button>
              <button
                className="btn sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                title="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              {generatePageNumbers(page, totalPages).map((p, i) =>
                p === '…' ? (
                  <span key={`ellipsis-${i}`} className="pagination-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    className={`btn sm${p === page ? ' active' : ''}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                className="btn sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>
              <button
                className="btn sm"
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                title="Last page"
              >
                {totalPages}
              </button>
            </div>
            <div className="pagination-jump">
              <span>Go to</span>
              <input
                type="number"
                className="form-input page-jump-input"
                min={1}
                max={totalPages}
                placeholder={page}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = Math.max(1, Math.min(totalPages, Number(e.target.value)));
                    if (val) { setPage(val); e.target.value = ''; }
                  }
                }}
              />
            </div>
            <div className="pagination-size">
              <select
                className="form-select"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              >
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
                <option value={200}>200 / page</option>
              </select>
            </div>
          </div>
        )}

        {/* Photo detail modal */}
        <PhotoDetailModal
          photo={detailPhoto}
          open={!!detailPhoto}
          onClose={() => setDetailPhoto(null)}
        />

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
