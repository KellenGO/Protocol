import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/chains', label: '主链' },
  { to: '/history', label: '协议时间线' },
  { to: '/rsip', label: 'RSIP' },
  { to: '/rsip-review', label: 'RSIP复盘' },
  { to: '/data-management', label: '数据管理' },
  { to: '/settings', label: '设置' },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-name">Protocol</span>
        <span className="brand-version">v0.3</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
