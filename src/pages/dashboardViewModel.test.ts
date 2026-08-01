import { nextDashboardView, parseDashboardView } from './dashboardViewModel.ts';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

assertEqual(parseDashboardView(new URLSearchParams()), 'overview', 'defaults to overview');
assertEqual(parseDashboardView(new URLSearchParams('view=chains')), 'chains', 'parses chains view');
assertEqual(parseDashboardView(new URLSearchParams('view=failures')), 'failures', 'parses failures view');
assertEqual(parseDashboardView(new URLSearchParams('view=precedents')), 'precedents', 'parses precedents view');
assertEqual(
  parseDashboardView(new URLSearchParams('view=unknown')),
  'overview',
  'falls back to overview for invalid values',
);
assertEqual(nextDashboardView('overview', 1), 'chains', 'moves to the next view');
assertEqual(nextDashboardView('overview', -1), 'precedents', 'wraps backward from overview');
assertEqual(nextDashboardView('precedents', 1), 'overview', 'wraps forward from precedents');
