import { useState, useEffect, useCallback } from 'react';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import FilePicker from '../components/FilePicker';
import { fetchJobs, createJob, startJob, cancelJob, deleteJob, deleteJobWithPhotos, fetchTestPresets, fetchProfiles } from '../api';

const statusVariant = { pending: 'orange', running: 'accent', overriding: 'cyan', done: 'green', error: 'red' };

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ sourceDir: '', destDir: '', mode: 'normal', minWidth: 600, minHeight: 600, minFilesize: 51200, performanceProfile: '' });
  const [picker, setPicker] = useState({ open: false, field: null });
  const [loadingTest, setLoadingTest] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);    // job to delete
  const [confirmPhotos, setConfirmPhotos] = useState(false); // second confirmation

  const load = useCallback(() => fetchJobs().then(setJobs).catch(console.error), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchProfiles().then(setProfiles).catch(console.error); }, []);

  /* Live-poll every 500ms while any job is running or overriding */
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'running' || j.status === 'overriding');
    if (hasActive) {
      const id = setInterval(load, 500);
      return () => clearInterval(id);
    }
  }, [jobs, load]);

  const handleCreate = async () => {
    /* Source safety: reject overlapping source/dest before hitting the API */
    const src = form.sourceDir.replace(/\/+$/, '');
    const dst = form.destDir.replace(/\/+$/, '');
    if (src === dst) {
      alert('Source and destination cannot be the same directory.');
      return;
    }
    if (dst.startsWith(src + '/')) {
      alert('Destination must not be inside the source directory. SnapSort never modifies source files.');
      return;
    }
    if (src.startsWith(dst + '/')) {
      alert('Source must not be inside the destination directory — this would cause SnapSort to re-process its own output.');
      return;
    }
    await createJob(form);
    setShowNew(false);
    setForm({ sourceDir: '', destDir: '', mode: 'normal', minWidth: 600, minHeight: 600, minFilesize: 51200, performanceProfile: '' });
    load();
  };

  /* Load Test Data — fetch presets, create one job per source, start them all */
  const handleLoadTest = async () => {
    setLoadingTest(true);
    try {
      const data = await fetchTestPresets();
      if (!data.available) {
        alert(data.message || 'No test data available');
        return;
      }
      const created = [];
      for (const preset of data.presets) {
        const job = await createJob({
          sourceDir: preset.sourceDir,
          destDir: preset.destDir,
          mode: 'normal',
          minWidth: 600,
          minHeight: 600,
          minFilesize: 51200,
        });
        created.push(job);
      }
      /* Start all created jobs */
      for (const job of created) {
        await startJob(job.id);
      }
      /* Immediately fetch so polling kicks in while jobs are running */
      await load();
    } catch (err) {
      console.error('Failed to load test data:', err);
      alert('Error loading test presets: ' + err.message);
    } finally {
      setLoadingTest(false);
    }
  };

  const pctBar = (r) => {
    if (!r.total_files || r.total_files === 0) return null;
    const pct = Math.round((r.processed / r.total_files) * 100);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--surface-2)' }}>
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: r.status === 'done' ? 'var(--green)' : 'var(--accent)', transition: 'width .3s' }} />
        </div>
        <span className="mono" style={{ fontSize: 12 }}>{pct}%</span>
      </div>
    );
  };

  const columns = [
    { key: 'id', header: 'ID', className: 'mono truncate', render: (r) => r.id.slice(0, 8) },
    { key: 'source_dir', header: 'Source', className: 'truncate', render: (r) => r.source_dir.split('/').pop() },
    { key: 'dest_dir', header: 'Destination', className: 'truncate', render: (r) => r.dest_dir.split('/').pop() },
    { key: 'mode', header: 'Mode', render: (r) => <Badge variant="cyan">{r.mode}</Badge> },
    { key: 'profile', header: 'Profile', render: (r) => {
      const p = profiles.find((pr) => pr.id === r.performance_profile);
      return p ? <Badge variant="pink">{p.name}</Badge> : <span className="mono" style={{ opacity: 0.4 }}>default</span>;
    }},
    { key: 'status', header: 'Status', render: (r) => <Badge variant={statusVariant[r.status] || 'accent'}>{r.status}</Badge> },
    {
      key: 'progress', header: 'Progress', className: 'mono', render: (r) =>
        r.status === 'running' ? pctBar(r) : `${r.processed}/${r.total_files || '?'}`,
    },
    {
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="flex gap-8">
          {r.status === 'pending' && <button className="btn sm primary" onClick={() => startJob(r.id).then(load)}>Start</button>}
          {r.status === 'running' && <button className="btn sm danger" onClick={() => cancelJob(r.id).then(load)}>Cancel</button>}
          {['done', 'error'].includes(r.status) && <button className="btn sm danger" onClick={() => setDeleteTarget(r)}>Delete</button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page-header flex justify-between items-center">
        <div>
          <h2>Jobs</h2>
          <p>Manage photo organization runs</p>
        </div>
        <div className="flex gap-8">
          <button
            className="btn"
            onClick={handleLoadTest}
            disabled={loadingTest}
          >
            {loadingTest ? 'Loading…' : '🧪 Load Test Data'}
          </button>
          <button className="btn primary" onClick={() => setShowNew(true)}>+ New Job</button>
        </div>
      </div>

      <div className="page-body">
        <DataTable columns={columns} rows={jobs} emptyMessage="No jobs created yet" />
      </div>

      <Modal
        open={showNew}
        title="New Organization Job"
        onClose={() => setShowNew(false)}
        footer={
          <>
            <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>
            <button className="btn primary" onClick={handleCreate} disabled={!form.sourceDir || !form.destDir}>Create</button>
          </>
        }
      >
        <div className="form-group">
          <label>Source Directory</label>
          <div className="flex gap-8">
            <input className="form-input mono" placeholder="/mnt/photos/source" value={form.sourceDir} onChange={(e) => setForm({ ...form, sourceDir: e.target.value })} />
            <button className="btn" onClick={() => setPicker({ open: true, field: 'sourceDir' })}>Browse…</button>
          </div>
        </div>
        <div className="form-group">
          <label>Destination Directory</label>
          <div className="flex gap-8">
            <input className="form-input mono" placeholder="/mnt/photos/organized" value={form.destDir} onChange={(e) => setForm({ ...form, destDir: e.target.value })} />
            <button className="btn" onClick={() => setPicker({ open: true, field: 'destDir' })}>Browse…</button>
          </div>
        </div>
        <div className="form-group">
          <label>Mode</label>
          <select className="form-select" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="normal">Normal — scan & copy all</option>
            <option value="manual">Manual — CSV marked files only</option>
            <option value="resume">Resume — skip already processed</option>
          </select>
        </div>
        <div className="form-group">
          <label>Performance Profile</label>
          <select className="form-select" value={form.performanceProfile} onChange={(e) => setForm({ ...form, performanceProfile: e.target.value })}>
            <option value="">Use global defaults</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.is_builtin ? '' : ' (custom)'}
              </option>
            ))}
          </select>
          {(() => {
            const p = form.performanceProfile
              ? profiles.find((pr) => pr.id === form.performanceProfile)
              : null;
            if (!p) return (
              <p className="form-hint">Uses the settings configured on the Settings page.</p>
            );
            return (
              <>
                {p.description && <p className="form-hint">{p.description}</p>}
                <div className="profile-summary">
                  <span>{p.enable_multithreading ? '⚡ Multi-threaded' : '🔄 Single-threaded'}</span>
                  <span>Workers: {p.max_workers}</span>
                  <span>Batch: {p.batch_size}</span>
                  <span>Copies: {p.concurrent_copies}</span>
                  <span>Hash: {(p.hash_bytes / 1024).toFixed(0)} KB</span>
                  {p.sequential_processing ? <span>📀 Sequential I/O</span> : null}
                </div>
              </>
            );
          })()}
        </div>
        <div className="flex gap-12">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Min Width (px)</label>
            <input className="form-input mono" type="number" value={form.minWidth} onChange={(e) => setForm({ ...form, minWidth: Number(e.target.value) })} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Min Height (px)</label>
            <input className="form-input mono" type="number" value={form.minHeight} onChange={(e) => setForm({ ...form, minHeight: Number(e.target.value) })} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Min File Size (bytes)</label>
            <input className="form-input mono" type="number" value={form.minFilesize} onChange={(e) => setForm({ ...form, minFilesize: Number(e.target.value) })} />
          </div>
        </div>
      </Modal>

      <FilePicker
        open={picker.open}
        title={picker.field === 'sourceDir' ? 'Select Source Directory' : 'Select Destination Directory'}
        onClose={() => setPicker({ open: false, field: null })}
        onSelect={(path) => {
          setForm((prev) => ({ ...prev, [picker.field]: path }));
          setPicker({ open: false, field: null });
        }}
      />

      {/* Delete dialog */}
      <Modal
        open={!!deleteTarget && !confirmPhotos}
        title="Delete Job"
        onClose={() => setDeleteTarget(null)}
        footer={
          <button className="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
        }
      >
        <p style={{ marginBottom: 12 }}>
          Job <strong className="mono">{deleteTarget?.id?.slice(0, 8)}</strong>{' '}
          — {deleteTarget?.copied || 0} copied, {deleteTarget?.skipped || 0} skipped, {deleteTarget?.errors || 0} errors
        </p>
        <div className="flex gap-8" style={{ flexDirection: 'column' }}>
          <button
            className="btn"
            onClick={async () => {
              await deleteJob(deleteTarget.id);
              setDeleteTarget(null);
              load();
            }}
          >
            🗑️ Delete Job Record Only
            <span style={{ display: 'block', fontSize: 12, opacity: 0.6, fontWeight: 400 }}>
              Removes the job from the database. Copied photos stay on disk.
            </span>
          </button>
          <button
            className="btn danger"
            onClick={() => setConfirmPhotos(true)}
          >
            ⚠️ Delete Job + Copied Photos
            <span style={{ display: 'block', fontSize: 12, opacity: 0.8, fontWeight: 400 }}>
              Removes the job AND deletes all {deleteTarget?.copied || 0} copied files from disk.
            </span>
          </button>
        </div>
      </Modal>

      {/* Confirm photo deletion */}
      <Modal
        open={confirmPhotos}
        title="⚠️ Confirm File Deletion"
        onClose={() => setConfirmPhotos(false)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmPhotos(false)}>Go Back</button>
            <button
              className="btn danger"
              onClick={async () => {
                await deleteJobWithPhotos(deleteTarget.id);
                setConfirmPhotos(false);
                setDeleteTarget(null);
                load();
              }}
            >
              Yes, Delete Files
            </button>
          </>
        }
      >
        <p>
          This will <strong>permanently delete {deleteTarget?.copied || 0} photo files</strong> from
          the destination directory. This action cannot be undone.
        </p>
        <p className="mono" style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>
          {deleteTarget?.dest_dir}
        </p>
      </Modal>
    </>
  );
}
