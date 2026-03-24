import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { fetchHealth } from '../api';
import ActiveJobIndicator from './ActiveJobIndicator';

const links = [
  { to: '/dashboard',  icon: '◉', label: 'Dashboard' },
  { to: '/drives',     icon: '💾', label: 'Drives' },
  { to: '/jobs',       icon: '▶', label: 'Jobs' },
  { to: '/photos',     icon: '▣', label: 'Photos' },
  { to: '/benchmarks', icon: '⏱', label: 'Benchmarks' },
  { to: '/settings',   icon: '⚙', label: 'Settings' },
];

export default function Sidebar({ open, onClose }) {
  const [version, setVersion] = useState(null);
  useEffect(() => {
    fetchHealth()
      .then((data) => setVersion(data.version))
      .catch(() => {});
  }, []);

  return (
    <>
      {/* Desktop sidebar — always visible on wide screens */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">S</div>
          <h1>SnapSort</h1>
          <span className="version">{version ? `v${version}` : ''}</span>
        </div>

        <nav className="sidebar-nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span className="nav-icon">{l.icon}</span>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <ActiveJobIndicator />
      </aside>

      {/* Mobile top-down drawer — hidden on desktop */}
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <div className={`mobile-drawer${open ? ' mobile-drawer-open' : ''}`}>
        <div className="mobile-drawer-header">
          <div className="sidebar-logo">
            <div className="logo-icon">S</div>
            <h1>SnapSort</h1>
          </div>
          <ActiveJobIndicator compact />
        </div>
        <nav className="mobile-drawer-nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={onClose}
            >
              <span className="nav-icon">{l.icon}</span>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  );
}
