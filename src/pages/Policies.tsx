import { NavLink, Outlet, useLocation } from 'react-router-dom';

const tabs = [
  { to: '/policies/tree', label: '国策树' },
  { to: '/policies/library', label: '国策库' },
  { to: '/policies/review', label: '复盘' },
];

export default function Policies() {
  const { pathname } = useLocation();

  return (
    <div className="page policies-page">
      <div className="policies-header">
        <h2>国策</h2>
        <p className="page-subtitle">个人的国策系统——记录结构、状态与历史，不替你做判断。</p>
      </div>
      <nav className="policies-tabs" role="tablist" aria-label="国策视图">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.to);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={`policies-tab${isActive ? ' active' : ''}`}
              role="tab"
              aria-selected={isActive}
            >
              {tab.label}
            </NavLink>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
