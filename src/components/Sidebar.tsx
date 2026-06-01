import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'D' },
  { to: '/chains', label: '主链', icon: 'C' },
  { to: '/history', label: '历史记录', icon: 'H' },
  { to: '/rsip', label: 'RSIP', icon: 'R' },
  { to: '/settings', label: '设置', icon: 'S' },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-name">Protocol</span>
        <span className="brand-version">v0.1</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
