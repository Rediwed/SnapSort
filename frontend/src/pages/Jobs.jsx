import { useState, useEffect } from 'react';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import FilePicker from '../components/FilePicker';
import { fetchJobs, createJob, startJob, cancelJob, deleteJob } from '../api';

const statusVariant = { pending: 'orange', running: 'accent', done: 'green', error: 'red' };

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ sourceDir: '', destDir: '', mode: 'normal', minWidth: 600, minHeight: 600, minFilesize: 51200 });
  const [picker, setPicker] = useState({ open: false, field: null }); // { open, field: 'sourceDir' | 'destDir' }

  const load = () => fetchJobs().then(setJobs).catch(console.error);
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    await createJob(form);
    setShowNew(false);
    setForm({ sourceDir: '', destDir: '', mode: 'normal', minWidth: 600, minHeight: 600, minFilesize: 51200 });
    load();
  };

  const columns = [
    { key: 'id', header: 'ID', className: 'mono truncate', render: (r) => r.id.slice(0, 8) },
    { key: 'source_dir', header: 'Source', className: 'truncate' },
    { key: 'dest_dir', header: 'Destination', className: 'truncate' },
    { key: 'mode', header: 'Mode', render: (r) => <Badge variant="cyan">{r.mode}</Badge> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={statusVariant[r.status] || 'accent'}>{r.status}</Badge> },
    { key: 'processed', header: 'Progress', className: 'mono', render: (r) => `${r.processed}/${r.total_files || '?'}` },
    {
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="flex gap-8">
          {r.status === 'pending' && <button className="btn sm primary" onClick={() => startJob(r.id).then(load)}>Start</button>}
          {r.status === 'running' && <button className="btn sm danger" onClick={() => cancelJob(r.id).then(load)}>Cancel</button>}
          {['done', 'error'].includes(r.status) && <button className="btn sm danger" onClick={() => deleteJob(r.id).then(load)}>Delete</button>}
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
        <button className="btn primary" onClick={() => setShowNew(true)}>+ New Job</button>
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
    </>
  );
}
