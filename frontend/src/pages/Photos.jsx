import { useState, useEffect } from 'react';
import Badge from '../components/Badge';
import PillTabs from '../components/PillTabs';
import DataTable from '../components/DataTable';
import { fetchPhotos } from '../api';

const statusVariant = { copied: 'green', skipped: 'orange', error: 'red', pending: 'accent' };

const tabs = [
  { value: '', label: 'All' },
  { value: 'copied', label: 'Copied' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'error', label: 'Errors' },
];

const columns = [
  { key: 'filename', header: 'Filename', className: 'truncate' },
  { key: 'extension', header: 'Ext', className: 'mono' },
  { key: 'status', header: 'Status', render: (r) => <Badge variant={statusVariant[r.status] || 'accent'}>{r.status}</Badge> },
  { key: 'skip_reason', header: 'Reason', className: 'truncate', render: (r) => r.skip_reason || '—' },
  { key: 'file_size', header: 'Size', className: 'mono', render: (r) => r.file_size ? `${(r.file_size / 1024).toFixed(0)} KB` : '—' },
  { key: 'width', header: 'W×H', className: 'mono', render: (r) => r.width ? `${r.width}×${r.height}` : '—' },
  { key: 'date_taken', header: 'Date', render: (r) => r.date_taken ? new Date(r.date_taken).toLocaleDateString() : '—' },
];

export default function Photos() {
  const [status, setStatus] = useState('');
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const params = {};
    if (status) params.status = status;
    fetchPhotos(params).then((d) => { setPhotos(d.photos); setTotal(d.total); }).catch(console.error);
  }, [status]);

  return (
    <>
      <div className="page-header">
        <h2>Photos</h2>
        <p>{total.toLocaleString()} photos processed across all jobs</p>
      </div>
      <div className="page-body">
        <PillTabs tabs={tabs} active={status} onChange={setStatus} />
        <DataTable columns={columns} rows={photos} emptyMessage="No photos found" />
      </div>
    </>
  );
}
