import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '◫' },
  { to: '/chains', label: '主链', icon: '⛓' },
  { to: '/reservation', label: '预约启动', icon: '◷' },
  { to: '/history', label: '历史记录', icon: '☰' },
  { to: '/rsip', label: 'RSIP', icon: '⊡' },
  { to: '/settings', label: '设置', icon: '⚙' },
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
            className={({ isActive }) =>
              `nav-item${isActive ? ' active' : ''}`
            }
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
