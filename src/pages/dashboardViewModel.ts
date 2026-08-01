export type DashboardView = 'overview' | 'chains' | 'failures' | 'precedents';

const DASHBOARD_VIEW_ORDER: DashboardView[] = ['overview', 'chains', 'failures', 'precedents'];

export function parseDashboardView(searchParams: URLSearchParams): DashboardView {
  const view = searchParams.get('view');
  if (view === 'chains' || view === 'failures' || view === 'precedents') {
    return view;
  }
  return 'overview';
}

export function nextDashboardView(current: DashboardView, offset: -1 | 1): DashboardView {
  const currentIndex = DASHBOARD_VIEW_ORDER.indexOf(current);
  const nextIndex = (currentIndex + offset + DASHBOARD_VIEW_ORDER.length) % DASHBOARD_VIEW_ORDER.length;
  return DASHBOARD_VIEW_ORDER[nextIndex];
}
