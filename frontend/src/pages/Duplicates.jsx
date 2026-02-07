import { useState, useEffect } from 'react';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import { fetchDuplicates, resolveDuplicate } from '../api';

export default function Duplicates() {
  const [duplicates, setDuplicates] = useState([]);
  const [total, setTotal] = useState(0);

  const load = () => fetchDuplicates().then((d) => { setDuplicates(d.duplicates); setTotal(d.total); }).catch(console.error);
  useEffect(() => { load(); }, []);

  const handleResolve = async (id, resolution) => {
    await resolveDuplicate(id, resolution);
    load();
  };

  const columns = [
    { key: 'src_path', header: 'Source', className: 'truncate' },
    { key: 'matched_path', header: 'Matched With', className: 'truncate', render: (r) => r.matched_path || '—' },
    {
      key: 'similarity', header: 'Similarity', className: 'mono',
      render: (r) => {
        const pct = r.similarity.toFixed(1);
        const variant = r.similarity >= 90 ? 'red' : r.similarity >= 70 ? 'orange' : 'accent';
        return <Badge variant={variant}>{pct}%</Badge>;
      },
    },
    {
      key: 'resolution', header: 'Resolution',
      render: (r) => {
        if (r.resolution === 'keep') return <Badge variant="green">Keep</Badge>;
        if (r.resolution === 'delete') return <Badge variant="red">Delete</Badge>;
        return <Badge variant="orange">Undecided</Badge>;
      },
    },
    {
      key: 'actions', header: 'Actions',
      render: (r) => (
        <div className="flex gap-8">
          <button className="btn sm" onClick={() => handleResolve(r.id, 'keep')}>Keep</button>
          <button className="btn sm danger" onClick={() => handleResolve(r.id, 'delete')}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <h2>Duplicates</h2>
        <p>{total.toLocaleString()} duplicate pairs detected</p>
      </div>
      <div className="page-body">
        <DataTable columns={columns} rows={duplicates} emptyMessage="No duplicates found" />
      </div>
    </>
  );
}
