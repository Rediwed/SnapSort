import { useState, useEffect, useRef } from 'react';
import { fetchActiveJobs, fetchActivePrescan } from '../api';

const POLL_INTERVAL = 1200; // ms

export default function ActiveJobIndicator({ compact = false }) {
  const [jobs, setJobs] = useState([]);
  const [prescans, setPrescans] = useState([]);
  const [visible, setVisible] = useState(false);
  const prevFileRef = useRef(null);
  const [fadeFile, setFadeFile] = useState(null);

  useEffect(() => {
    let mounted = true;
    const poll = () => {
      fetchActiveJobs()
        .then((data) => { if (mounted) setJobs(data); })
        .catch(() => {});
      fetchActivePrescan()
        .then((data) => { if (mounted) setPrescans(data.filter((p) => p.status === 'scanning')); })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    setVisible(jobs.length > 0 || prescans.length > 0);
  }, [jobs, prescans]);

  /* Animate file name transitions */
  const activeJob = jobs[0];
  const activePrescan = prescans[0];
  const currentFile = activeJob?.currentFile || activePrescan?.currentFile || null;

  useEffect(() => {
    if (currentFile && currentFile !== prevFileRef.current) {
      setFadeFile(currentFile);
      prevFileRef.current = currentFile;
    }
  }, [currentFile]);

  if (!visible) return null;

  /* Render prescan indicator if no active job but there's an active prescan */
  if (!activeJob && activePrescan) {
    const scanned = activePrescan.totalScanned || 0;
    const images = activePrescan.imageCount || 0;

    if (compact) {
      return (
        <div className="active-job-compact">
          <div className="active-job-compact-bar">
            <div className="active-job-compact-fill" style={{ width: '100%', animation: 'aji-pulse-bar 1.5s ease-in-out infinite' }} />
          </div>
          <span className="active-job-compact-label">Scanning</span>
        </div>
      );
    }

    return (
      <div className="active-job-indicator">
        <div className="aji-header">
          <span className="aji-pulse" />
          <span className="aji-title">Pre-scanning</span>
          <span className="aji-pct">{images.toLocaleString()} 📷</span>
        </div>
        <div className="aji-progress-track">
          <div className="aji-progress-fill aji-progress-indeterminate" />
        </div>
        <div className="aji-stats">
          <span>{scanned.toLocaleString()} files scanned</span>
          <span className="aji-source" title={activePrescan.path}>{activePrescan.driveName}</span>
        </div>
        {fadeFile && (
          <div className="aji-file" key={fadeFile}>
            {fadeFile}
          </div>
        )}
      </div>
    );
  }

  if (!activeJob) return null;

  const processed = activeJob.processed || 0;
  const total = activeJob.total_files || 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const sourceLabel = activeJob.source_dir?.split('/').pop() || 'Job';

  if (compact) {
    /* Mobile: minimal inline bar */
    return (
      <div className="active-job-compact">
        <div className="active-job-compact-bar">
          <div className="active-job-compact-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="active-job-compact-label">{pct}%</span>
      </div>
    );
  }

  return (
    <div className="active-job-indicator">
      <div className="aji-header">
        <span className="aji-pulse" />
        <span className="aji-title">Processing</span>
        <span className="aji-pct">{pct}%</span>
      </div>
      <div className="aji-progress-track">
        <div className="aji-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="aji-stats">
        <span>{processed.toLocaleString()} / {total.toLocaleString()}</span>
        <span className="aji-source" title={activeJob.source_dir}>{sourceLabel}</span>
      </div>
      {fadeFile && (
        <div className="aji-file" key={fadeFile}>
          {fadeFile}
        </div>
      )}
    </div>
  );
}
