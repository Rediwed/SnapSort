import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { fetchHealth } from '../api';
import ActiveJobIndicator from './ActiveJobIndicator';
import { LayoutDashboard, HardDrive, Play, Image, Timer, Settings } from 'lucide-react';

const links = [
  { to: '/dashboard',  icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
  { to: '/drives',     icon: <HardDrive size={18} />, label: 'Drives' },
  { to: '/jobs',       icon: <Play size={18} />, label: 'Jobs' },
  { to: '/photos',     icon: <Image size={18} />, label: 'Photos' },
  { to: '/benchmarks', icon: <Timer size={18} />, label: 'Benchmarks' },
  { to: '/settings',   icon: <Settings size={18} />, label: 'Settings' },
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
