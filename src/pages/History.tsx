import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProtocolHistory, getChains } from '../lib/db';
import type { Chain, ProtocolEvent } from '../types';

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

function formatDateTime(raw: string): string {
  return new Date(raw + 'Z').toLocaleString('zh-CN');
}

export default function History() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<ProtocolEvent[]>([]);
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
    getProtocolHistory({
      typeFilter,
      resultFilter,
      chainId: chainFilter,
    })
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [typeFilter, resultFilter, chainFilter]);

  return (
    <div className="page">
      <h2>历史记录</h2>

      {/* Filters */}
      <div className="filter-bar">
        <select
          className="form-select filter-select"
          value={typeFilter ?? ''}
          onChange={(e) => setTypeFilter(e.target.value || null)}
        >
          <option value="">全部类型</option>
          <option value="focus">正式任务</option>
          <option value="reservation">预约</option>
        </select>

        <select
          className="form-select filter-select"
          value={resultFilter ?? ''}
          onChange={(e) => setResultFilter(e.target.value || null)}
        >
          <option value="">全部结果</option>
          <option value="success">成功 / 履约</option>
          <option value="failed">失败</option>
          <option value="precedent">判例化</option>
        </select>

        <select
          className="form-select filter-select"
          value={chainFilter ?? ''}
          onChange={(e) => setChainFilter(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">全部主链</option>
          {chains.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Events */}
      {loading ? (
        <p className="placeholder-text">加载中…</p>
      ) : events.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 40 }}>
          <p className="empty-title">
            {typeFilter || resultFilter || chainFilter
              ? '没有匹配的记录'
              : '暂无历史记录'}
          </p>
          <p className="empty-desc">
            {typeFilter || resultFilter || chainFilter
              ? '尝试调整筛选条件。'
              : '完成正式任务或预约后，记录会出现在这里。'}
          </p>
        </div>
      ) : (
        <div className="history-list">
          {events.map((e) => (
            <div key={`${e.event_type}-${e.id}`} className="history-item">
              <div className="history-item-left">
                <span className={`event-type-badge event-${e.event_type}`}>
                  {eventTypeLabel(e.event_type)}
                </span>
                <div className="history-item-info">
                  <button
                    className="history-chain-link"
                    onClick={() => navigate(`/chains/${e.chain_id}`)}
                  >
                    {e.chain_name}
                  </button>
                  <span className="history-event-time">
                    {formatDateTime(e.event_time)}
                    {e.ended_at && ` → ${formatDateTime(e.ended_at!)}`}
                  </span>
                </div>
              </div>
              <span className={`history-result result-${e.result}`}>
                {eventLabel(e)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
