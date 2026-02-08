import { useState, useEffect, useRef } from 'react';
import { fetchActiveJobs } from '../api';

const POLL_INTERVAL = 1200; // ms

export default function ActiveJobIndicator({ compact = false }) {
  const [jobs, setJobs] = useState([]);
  const [visible, setVisible] = useState(false);
  const prevFileRef = useRef(null);
  const [fadeFile, setFadeFile] = useState(null);

  useEffect(() => {
    let mounted = true;
    const poll = () => {
      fetchActiveJobs()
        .then((data) => {
          if (!mounted) return;
          setJobs(data);
          setVisible(data.length > 0);
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  /* Animate file name transitions */
  const activeJob = jobs[0];
  const currentFile = activeJob?.currentFile || null;

  useEffect(() => {
    if (currentFile && currentFile !== prevFileRef.current) {
      setFadeFile(currentFile);
      prevFileRef.current = currentFile;
    }
  }, [currentFile]);

  if (!visible || !activeJob) return null;

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
