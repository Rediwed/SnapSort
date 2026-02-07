import { useState, useEffect } from 'react';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import { fetchDashboard } from '../api';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i ? 1 : 0)} ${units[i]}`;
}

const statusVariant = {
  pending: 'orange',
  running: 'accent',
  done: 'green',
  error: 'red',
};

const recentColumns = [
  { key: 'id', header: 'ID', className: 'mono truncate', render: (r) => r.id.slice(0, 8) },
  { key: 'mode', header: 'Mode', render: (r) => <Badge variant="cyan">{r.mode}</Badge> },
  { key: 'status', header: 'Status', render: (r) => <Badge variant={statusVariant[r.status] || 'accent'}>{r.status}</Badge> },
  { key: 'processed', header: 'Processed', className: 'mono' },
  { key: 'copied', header: 'Copied', className: 'mono' },
  { key: 'created_at', header: 'Created', render: (r) => new Date(r.created_at).toLocaleDateString() },
];

export default function Dashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetchDashboard().then(setStats).catch(console.error);
  }, []);

  if (!stats) return <div className="page-body">Loading…</div>;

  return (
    <>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Overview of your photo organization activity</p>
      </div>

      <div className="page-body">
        <div className="stat-grid">
          <StatCard label="Total Jobs" value={stats.totalJobs} variant="accent" />
          <StatCard label="Active Jobs" value={stats.activeJobs} variant="cyan" />
          <StatCard label="Photos Copied" value={stats.copiedPhotos} variant="green" />
          <StatCard label="Photos Skipped" value={stats.skippedPhotos} variant="orange" />
          <StatCard label="Errors" value={stats.errorPhotos} variant="red" />
          <StatCard label="Duplicates Found" value={stats.totalDuplicates} variant="pink" />
          <StatCard label="Total Processed" value={stats.totalPhotos} variant="accent" />
          <StatCard label="Total Size" value={formatBytes(stats.totalBytes)} variant="cyan" />
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Recent Jobs</h3>
          </div>
          <DataTable columns={recentColumns} rows={stats.recentJobs} emptyMessage="No jobs yet" />
        </div>
      </div>
    </>
  );
}
