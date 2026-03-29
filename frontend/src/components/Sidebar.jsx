import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { LayoutDashboard, HardDrive, Play, Image, Timer, Settings, Stethoscope } from 'lucide-react';
import { fetchHealth, fetchSettings } from '../api';
import ActiveJobIndicator from './ActiveJobIndicator';

const baseLinks = [
  { to: '/dashboard',  icon: <LayoutDashboard size={16} />, label: 'Dashboard' },
  { to: '/drives',     icon: <HardDrive size={16} />, label: 'Drives' },
  { to: '/jobs',       icon: <Play size={16} />, label: 'Jobs' },
  { to: '/photos',     icon: <Image size={16} />, label: 'Photos' },
  { to: '/benchmarks', icon: <Timer size={16} />, label: 'Benchmarks' },
  { to: '/settings',   icon: <Settings size={16} />, label: 'Settings' },
];

const diagLink = { to: '/diagnostics', icon: <Stethoscope size={16} />, label: 'Diagnostics' };

export default function Sidebar({ open, onClose }) {
  const [version, setVersion] = useState(null);
  const [diagEnabled, setDiagEnabled] = useState(false);

  useEffect(() => {
    fetchHealth()
      .then((data) => setVersion(data.version))
      .catch(() => {});
    fetchSettings()
      .then((s) => setDiagEnabled(s.diagnostics_enabled === 'true'))
      .catch(() => {});
  }, []);

  const links = diagEnabled ? [...baseLinks, diagLink] : baseLinks;

  return (
    <>
      {/* Desktop sidebar — always visible on wide screens */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img className="logo-icon" src="/favicon.svg" alt="SnapSort" />
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
            <img className="logo-icon" src="/favicon.svg" alt="SnapSort" />
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
