import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardSummary, getRecentProtocolEvents } from '../lib/db';
import type { DashboardSummary, ProtocolEvent } from '../types';

function eventLabel(event: ProtocolEvent): string {
  if (event.event_type === 'focus') {
    if (event.result === 'completed') return '正式任务完成';
    if (event.result === 'failed_reset') return '正式任务违规，主链清零';
    if (event.result === 'failed_precedent') return '正式任务判例化';
  } else {
    if (event.result === 'fulfilled') return '预约已履约';
    if (event.result === 'failed_reset') return '预约失败';
    if (event.result === 'failed_precedent') return '预约判例化';
  }
  return event.result;
}

function eventTypeLabel(type: string): string {
  return type === 'focus' ? '正式任务' : '预约';
}

function formatTime(raw: string): string {
  const d = new Date(raw + 'Z');
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [events, setEvents] = useState<ProtocolEvent[]>([]);

  useEffect(() => {
    Promise.all([getDashboardSummary(), getRecentProtocolEvents()])
      .then(([s, e]) => {
        setSummary(s);
        setEvents(e);
      })
      .catch(console.error);
  }, []);

  const activeState = summary?.active_protocol_state ?? 'none';

  return (
    <div className="page">
      <h2>Dashboard</h2>

      {/* Stat cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">主链总数</span>
          <span className="stat-value">{summary?.chain_count ?? '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">当前最长链</span>
          <span className="stat-value">{summary?.max_current_chain_length ?? '—'} 节</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">今日完成任务</span>
          <span className="stat-value">{summary?.today_completed_focus_count ?? '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">历史累计完成</span>
          <span className="stat-value">{summary?.total_completed_focus_count ?? '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">当前活跃协议状态</span>
          <span className="stat-value stat-detail">
            {activeState === 'focus' && (
              <>正式任务进行中</>
            )}
            {activeState === 'reservation_countdown' && (
              <>预约进行中</>
            )}
            {activeState === 'reservation_due' && (
              <>预约已到期，待履约</>
            )}
            {activeState === 'none' && (
              <>无活跃协议流程</>
            )}
          </span>
        </div>
      </div>

      {/* Active state action */}
      {activeState !== 'none' && summary?.active_chain_id && (
        <div className="active-banner">
          <span className="active-banner-text">
            {summary.active_chain_name}
          </span>
          {activeState === 'focus' ? (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/chains/${summary.active_chain_id}/focus`)}
            >
              恢复任务
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => navigate('/reservation')}
            >
              查看预约
            </button>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div className="quick-actions">
        <button className="btn btn-secondary" onClick={() => navigate('/chains')}>
          CTDP 链列表
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/reservation')}>
          预约启动
        </button>
      </div>

      {/* Recent events */}
      <div className="recent-section">
        <h3>最近活动</h3>
        {events.length === 0 ? (
          <p className="placeholder-text">暂无协议事件</p>
        ) : (
          <div className="recent-list">
            {events.map((e) => (
              <div key={`${e.event_type}-${e.id}`} className="recent-item">
                <div className="recent-item-left">
                  <span className={`event-type-badge event-${e.event_type}`}>
                    {eventTypeLabel(e.event_type)}
                  </span>
                  <span className="recent-chain-name">{e.chain_name}</span>
                </div>
                <div className="recent-item-right">
                  <span className={`recent-result result-${e.result}`}>
                    {eventLabel(e)}
                  </span>
                  <span className="recent-time">{formatTime(e.event_time)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
