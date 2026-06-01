import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getChains, getProtocolTimeline } from '../lib/db';
import type { Chain, ProtocolTimelineEvent } from '../types';

function eventLabel(event: ProtocolTimelineEvent): string {
  const title = event.precedent_title ?? event.note ?? '详情';

  if (event.event_type === 'focus') {
    if (event.result === 'completed') return '主链完成：神圣座位完成，链长延续';
    if (event.result === 'failed_reset') {
      return `主链裁决：${event.note ? `争议行为为“${event.note}”，` : ''}链条断裂并清零`;
    }
    if (event.result === 'failed_precedent') {
      return `主链判例化：允许“${title}”，未来同类行为默认允许`;
    }
  }

  if (event.event_type === 'reservation') {
    if (event.result === 'fulfilled') return '辅助链履约：按约定进入神圣座位';
    if (event.result === 'failed_reset') {
      return `辅助链失败：${event.note ? `${event.note}，` : ''}主链长度不受影响`;
    }
    if (event.result === 'failed_precedent') {
      return `辅助链判例化：允许“${title}”，未来同类情况默认允许`;
    }
  }

  if (event.event_type === 'rsip') {
    if (event.result === 'created') return 'RSIP 定式创建';
    if (event.result === 'activated') return 'RSIP 定式点亮';
    if (event.result === 'deactivated') return 'RSIP 定式熄灭';
    if (event.result === 'rollback_child_deactivated') return 'RSIP 子定式回滚熄灭';
  }

  return event.result;
}

function eventTypeLabel(type: string): string {
  if (type === 'focus') return '主链';
  if (type === 'reservation') return '辅助链';
  return 'RSIP';
}

function formatDateTime(raw: string): string {
  return new Date(raw + 'Z').toLocaleString('zh-CN');
}

export default function History() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<ProtocolTimelineEvent[]>([]);
  const [chains, setChains] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<string | null>(null);
  const [chainFilter, setChainFilter] = useState<number | null>(null);

  useEffect(() => {
    getChains().then(setChains).catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    getProtocolTimeline({
      typeFilter,
      resultFilter,
      chainId: chainFilter,
      limit: 150,
    })
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [typeFilter, resultFilter, chainFilter]);

  const hasFilter = typeFilter || resultFilter || chainFilter;

  return (
    <div className="page">
      <h2>协议时间线</h2>

      <div className="filter-bar">
        <select className="form-select filter-select" value={typeFilter ?? ''} onChange={(e) => setTypeFilter(e.target.value || null)}>
          <option value="">全部类型</option>
          <option value="focus">主链</option>
          <option value="reservation">辅助链</option>
          <option value="rsip">RSIP</option>
        </select>

        <select className="form-select filter-select" value={resultFilter ?? ''} onChange={(e) => setResultFilter(e.target.value || null)}>
          <option value="">全部结果</option>
          <option value="success">完成 / 履约 / 点亮</option>
          <option value="failed">断链 / 未履约 / 熄灭</option>
          <option value="precedent">判例化</option>
        </select>

        <select className="form-select filter-select" value={chainFilter ?? ''} onChange={(e) => setChainFilter(e.target.value ? Number(e.target.value) : null)}>
          <option value="">全部主链</option>
          {chains.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="placeholder-text">加载中...</p>
      ) : events.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 40 }}>
          <p className="empty-title">{hasFilter ? '没有匹配的协议事件' : '暂无协议事件'}</p>
          <p className="empty-desc">
            {hasFilter ? '尝试调整筛选条件。' : '完成主链、辅助链履约或做出裁决后，事件会出现在这里。'}
          </p>
        </div>
      ) : (
        <div className="history-list">
          {events.map((e) => (
            <div key={`${e.event_type}-${e.id}`} className="history-item">
              <div className="history-item-left">
                <span className={`event-type-badge event-${e.event_type}`}>{eventTypeLabel(e.event_type)}</span>
                <div className="history-item-info">
                  {e.event_type === 'rsip' ? (
                    <button className="history-chain-link" onClick={() => navigate('/rsip')}>
                      {e.formula_title ?? 'RSIP 定式'}
                    </button>
                  ) : (
                    <button className="history-chain-link" onClick={() => e.chain_id && navigate(`/chains/${e.chain_id}`)}>
                      {e.chain_name}
                    </button>
                  )}
                  <span className="history-event-time">
                    {formatDateTime(e.event_time)}
                    {e.ended_at && ` -> ${formatDateTime(e.ended_at)}`}
                  </span>
                  {e.note && <span className="history-event-note">争议行为类型：{e.note}</span>}
                </div>
              </div>
              <span className={`history-result result-${e.result}`}>{eventLabel(e)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
