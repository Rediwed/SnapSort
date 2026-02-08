import { NavLink } from 'react-router-dom';

const links = [
  { to: '/dashboard',  icon: '◉', label: 'Dashboard' },
  { to: '/jobs',       icon: '▶', label: 'Jobs' },
  { to: '/photos',     icon: '▣', label: 'Photos' },
  { to: '/duplicates', icon: '⊜', label: 'Duplicates' },
  { to: '/benchmarks', icon: '⏱', label: 'Benchmarks' },
  { to: '/settings',   icon: '⚙', label: 'Settings' },
];

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {/* Overlay — visible only on mobile when menu is open */}
      {open && <div className="sidebar-overlay" onClick={onClose} />}

      <aside className={`sidebar${open ? ' sidebar-open' : ''}`}>
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
              onClick={onClose}
            >
              <span className="nav-icon">{l.icon}</span>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
