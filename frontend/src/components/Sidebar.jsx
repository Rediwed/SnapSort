import { NavLink } from 'react-router-dom';

const links = [
  { to: '/dashboard',  icon: '◉', label: 'Dashboard' },
  { to: '/jobs',       icon: '▶', label: 'Jobs' },
  { to: '/photos',     icon: '▣', label: 'Photos' },
  { to: '/benchmarks', icon: '⏱', label: 'Benchmarks' },
  { to: '/settings',   icon: '⚙', label: 'Settings' },
];

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {/* Desktop sidebar — always visible on wide screens */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">S</div>
          <h1>SnapSort</h1>
          <span className="version">v1.0</span>
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
      </aside>

      {/* Mobile top-down drawer — hidden on desktop */}
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <div className={`mobile-drawer${open ? ' mobile-drawer-open' : ''}`}>
        <div className="mobile-drawer-header">
          <div className="sidebar-logo">
            <div className="logo-icon">S</div>
            <h1>SnapSort</h1>
          </div>
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
