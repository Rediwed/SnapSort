import { useState, useEffect, useRef, useCallback } from 'react';
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

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtJobLabel = (job) => {
  const dir = job.source_dir.split('/').pop() || job.source_dir;
  const date = new Date(job.created_at);
  const short = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${dir} — ${short}`;
};

export default function Photos() {
  const [status, setStatus] = useState('');
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [overriding, setOverriding] = useState(false);

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

  /* Checkbox helpers */
  const skippedPhotos = photos.filter((p) => p.status === 'skipped');
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
            className="job-dropdown"
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
                  {/* Checkbox column – only for skipped filter or when skipped exist */}
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
                  <th>Filename</th>
                  <th>Ext</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Size</th>
                  <th>W×H</th>
                  <th>Date Taken</th>
                  <th>Processed</th>
                </tr>
              </thead>
              <tbody>
                {photos.map((photo) => (
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
