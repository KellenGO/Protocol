import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardSummary, getRecentProtocolEvents, getRsipSummary } from '../lib/db';
import type { DashboardSummary, ProtocolEvent, RsipSummary } from '../types';

function eventLabel(event: ProtocolEvent): string {
  if (event.event_type === 'focus') {
    if (event.result === 'completed') return '主链完成';
    if (event.result === 'failed_reset') return '神圣座位裁决：断链';
    if (event.result === 'failed_precedent') return '主链判例化';
  } else {
    if (event.result === 'fulfilled') return '辅助链履约';
    if (event.result === 'failed_reset') return '辅助链失败';
    if (event.result === 'failed_precedent') return '辅助链判例化';
  }
  return event.result;
}

function eventTypeLabel(type: string): string {
  return type === 'focus' ? '主链' : '辅助链';
}

function rsipEventLabel(type: string): string {
  if (type === 'created') return '定式创建';
  if (type === 'activated') return '定式点亮';
  if (type === 'deactivated') return '定式熄灭';
  if (type === 'rollback_child_deactivated') return '递归回滚';
  return type;
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

function activeStateLabel(state: DashboardSummary['active_protocol_state']): string {
  if (state === 'focus') return '神圣座位已占用';
  if (state === 'focus_pending_ruling') return '神圣座位待裁决';
  if (state === 'reservation_countdown') return '辅助链预约中';
  if (state === 'reservation_due') return '辅助链已自动失败';
  if (state === 'reservation_pending_ruling') return '辅助链预约中';
  return '无活跃协议流程';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [rsipSummary, setRsipSummary] = useState<RsipSummary | null>(null);
  const [events, setEvents] = useState<ProtocolEvent[]>([]);

  useEffect(() => {
    Promise.all([getDashboardSummary(), getRecentProtocolEvents(), getRsipSummary()])
      .then(([s, e, r]) => {
        setSummary(s);
        setEvents(e);
        setRsipSummary(r);
      })
      .catch(console.error);
  }, []);

  const activeState = summary?.active_protocol_state ?? 'none';

  return (
    <div className="page">
      <h2>Dashboard</h2>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">主链总数</span>
          <span className="stat-value">{summary?.chain_count ?? '-'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">当前最长链</span>
          <span className="stat-value">{summary?.max_current_chain_length ?? '-'} 节</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">今日完成主链</span>
          <span className="stat-value">{summary?.today_completed_focus_count ?? '-'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">历史累计完成</span>
          <span className="stat-value">{summary?.total_completed_focus_count ?? '-'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">当前协议状态</span>
          <span className="stat-value stat-detail">{activeStateLabel(activeState)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">RSIP 定式格</span>
          <span className="stat-value">{rsipSummary?.total_formulas ?? '-'}</span>
          <span className="stat-detail">
            已点亮 {rsipSummary?.active_formulas ?? '-'} / 未点亮 {rsipSummary?.inactive_formulas ?? '-'}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">最近 RSIP 状态</span>
          <span className="stat-value stat-detail">
            {rsipSummary?.latest_event ? rsipEventLabel(rsipSummary.latest_event.event_type) : '暂无定式事件'}
          </span>
          {rsipSummary?.latest_event && (
            <span className="stat-detail">{rsipSummary.latest_event.formula_title}</span>
          )}
        </div>
      </div>

      {activeState !== 'none' && summary?.active_chain_id && (
        <div className="active-banner">
          <span className="active-banner-text">{summary.active_chain_name}</span>
          {activeState === 'focus' || activeState === 'focus_pending_ruling' ? (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/chains/${summary.active_chain_id}/focus${activeState === 'focus_pending_ruling' ? '?mode=ruling' : ''}`)}
            >
              {activeState === 'focus_pending_ruling' ? '回到裁决' : '回到神圣座位'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/chains/${summary.active_chain_id}?mode=aux`)}
            >
              查看辅助链
            </button>
          )}
        </div>
      )}

      <div className="quick-actions">
        <button className="btn btn-secondary" onClick={() => navigate('/chains')}>CTDP 主链</button>
        <button className="btn btn-secondary" onClick={() => navigate('/rsip')}>RSIP 定式格</button>
      </div>

      <div className="recent-section">
        <h3>最近活动</h3>
        {events.length === 0 ? (
          <p className="placeholder-text">暂无协议事件</p>
        ) : (
          <div className="recent-list">
            {events.map((e) => (
              <div key={`${e.event_type}-${e.id}`} className="recent-item">
                <div className="recent-item-left">
                  <span className={`event-type-badge event-${e.event_type}`}>{eventTypeLabel(e.event_type)}</span>
                  <span className="recent-chain-name">{e.chain_name}</span>
                </div>
                <div className="recent-item-right">
                  <span className={`recent-result result-${e.result}`}>{eventLabel(e)}</span>
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
