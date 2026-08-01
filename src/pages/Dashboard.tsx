import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getDashboardSummary, getRecentProtocolEvents } from '../lib/db';
import {
  formatRelativeProtocolTime,
  protocolEventTypeLabel,
} from '../lib/protocolEvents';
import type { DashboardSummary, ProtocolEvent } from '../types';
import Review from './Review';
import {
  nextDashboardView,
  parseDashboardView,
  type DashboardView,
} from './dashboardViewModel';

const DASHBOARD_TABS: { key: DashboardView; label: string }[] = [
  { key: 'overview', label: '总览' },
  { key: 'chains', label: '主链复盘' },
  { key: 'failures', label: '失败模式' },
  { key: 'precedents', label: '判例复盘' },
];

function eventLabel(event: ProtocolEvent): string {
  if (event.event_type === 'focus') {
    if (event.result === 'completed') return '主链完成';
    if (event.result === 'failed_reset') return '神圣座位裁决：断链';
    if (event.result === 'failed_precedent') return '主链判例化';
  } else {
    if (event.result === 'fulfilled') return '辅助链履约';
    if (event.result === 'failed_reset') return '辅助链失败清零';
    if (event.result === 'failed_precedent') return '辅助链判例化';
  }
  return event.result;
}

function activeStateLabel(state: DashboardSummary['active_protocol_state']): string {
  if (state === 'focus') return '神圣座位已占用';
  if (state === 'focus_pending_ruling') return '神圣座位待裁决';
  if (state === 'reservation_countdown') return '辅助链预约中';
  if (state === 'reservation_due') return '辅助链待确认';
  if (state === 'reservation_pending_ruling') return '辅助链待裁决';
  return '无活跃协议流程';
}

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseDashboardView(searchParams);

  function selectView(nextView: DashboardView) {
    const nextParams = new URLSearchParams(searchParams);
    if (nextView === 'overview') {
      nextParams.delete('view');
    } else {
      nextParams.set('view', nextView);
    }
    setSearchParams(nextParams);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentView: DashboardView) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextView = nextDashboardView(currentView, event.key === 'ArrowRight' ? 1 : -1);
    selectView(nextView);
    requestAnimationFrame(() => document.getElementById(`dashboard-tab-${nextView}`)?.focus());
  }

  return (
    <div className="page dashboard-page">
      <div className="dashboard-header">
        <div className="page-title-block">
          <h2>Dashboard</h2>
          <p className="page-subtitle">当前协议状态与历史复盘</p>
        </div>
      </div>

      <div className="dashboard-tabs" role="tablist" aria-label="Dashboard 视图">
        {DASHBOARD_TABS.map((tab) => (
          <button
            key={tab.key}
            id={`dashboard-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={view === tab.key}
            aria-controls={`dashboard-panel-${tab.key}`}
            tabIndex={view === tab.key ? 0 : -1}
            className={`dashboard-tab ${view === tab.key ? 'dashboard-tab-active' : ''}`}
            onClick={() => selectView(tab.key)}
            onKeyDown={(event) => handleTabKeyDown(event, tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={`dashboard-panel-${view}`}
        role="tabpanel"
        aria-labelledby={`dashboard-tab-${view}`}
      >
        {view === 'overview' ? <DashboardOverview /> : <Review tab={view} />}
      </div>
    </div>
  );
}

function DashboardOverview() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [events, setEvents] = useState<ProtocolEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getDashboardSummary()
      .then((nextSummary) => {
        if (!cancelled) setSummary(nextSummary);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setSummaryError(true);
      });

    getRecentProtocolEvents()
      .then((nextEvents) => {
        if (!cancelled) setEvents(nextEvents);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setEventsError(true);
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const activeState = summary?.active_protocol_state ?? 'none';
  const hasActiveProtocol = activeState !== 'none' && Boolean(summary?.active_chain_id);

  return (
    <div className="dashboard-overview" role="tabpanel">
      <div
        className={`active-banner ${hasActiveProtocol ? '' : 'active-banner-idle'}`}
        role="status"
        aria-live="polite"
      >
        <div className="active-banner-copy">
          <span className="active-banner-label">当前协议状态</span>
          <strong className="active-banner-text">
            {summaryError
              ? '协议状态读取失败'
              : summary === null
              ? '正在读取协议状态...'
              : hasActiveProtocol
                ? summary.active_chain_name
                : '无活跃协议流程'}
          </strong>
          {summary !== null && hasActiveProtocol && (
            <span className="active-banner-detail">{activeStateLabel(activeState)}</span>
          )}
        </div>

        {hasActiveProtocol && summary?.active_chain_id && (
          activeState === 'focus' || activeState === 'focus_pending_ruling' ? (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/chains/${summary.active_chain_id}/focus${activeState === 'focus_pending_ruling' ? '?mode=ruling' : ''}`)}
            >
              {activeState === 'focus_pending_ruling' ? '回到裁决' : '回到神圣座位'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/chains/${summary.active_chain_id}/auxiliary`)}
            >
              查看辅助链
            </button>
          )
        )}
      </div>

      <section className="recent-section">
        <h3>最近活动</h3>
        {eventsLoading ? (
          <p className="placeholder-text" aria-live="polite">正在读取最近活动...</p>
        ) : eventsError ? (
          <p className="placeholder-text" role="alert">最近活动读取失败，请稍后重试。</p>
        ) : events.length === 0 ? (
          <p className="placeholder-text" aria-live="polite">暂无协议事件</p>
        ) : (
          <div className="recent-list">
            {events.map((event) => (
              <div key={`${event.event_type}-${event.id}`} className="recent-item">
                <div className="recent-item-left">
                  <span className={`event-type-badge event-${event.event_type}`}>
                    {protocolEventTypeLabel(event.event_type)}
                  </span>
                  <span className="recent-chain-name">{event.chain_name}</span>
                </div>
                <div className="recent-item-right">
                  <span className={`recent-result result-${event.result}`}>{eventLabel(event)}</span>
                  <span className="recent-time">{formatRelativeProtocolTime(event.event_time)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
