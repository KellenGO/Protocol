import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getChains } from '../lib/db';
import CreateChainForm from '../features/ctdp/CreateChainForm';
import type { Chain } from '../types';

export default function ChainList() {
  const [chains, setChains] = useState<Chain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();

  function loadChains() {
    getChains()
      .then(setChains)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadChains();
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>主链</h2>
          <p className="page-subtitle">
            每条主链都是一份协议：神圣座位触发动作、持续时间、完成条件，以及一条内嵌辅助链。
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + 新建主链
        </button>
      </div>

      {showForm && (
        <div className="form-overlay">
          <CreateChainForm
            onCreated={(chain) => {
              setChains((prev) => [chain, ...prev]);
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {loading ? (
        <p className="placeholder-text">加载中...</p>
      ) : chains.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">还没有主链</p>
          <p className="empty-desc">
            创建一条主链，先把触发动作和完成条件写清楚，再启动神圣座位。
          </p>
        </div>
      ) : (
        <div className="chain-list">
          {chains.map((chain) => (
            <button
              key={chain.id}
              className="chain-card"
              onClick={() => navigate(`/chains/${chain.id}`)}
            >
              <div className="chain-card-main">
                <span className="chain-card-name">{chain.name}</span>
                <span className="chain-card-desc">{chain.trigger_action}</span>
              </div>
              <div className="chain-card-stats">
                <span className="chain-stat">
                  <span className="chain-stat-label">当前</span>
                  <span className="chain-stat-value">{chain.current_length} 节</span>
                </span>
                <span className="chain-stat">
                  <span className="chain-stat-label">最佳</span>
                  <span className="chain-stat-value">{chain.best_length} 节</span>
                </span>
                <span className="chain-stat">
                  <span className="chain-stat-label">主链</span>
                  <span className="chain-stat-value">{chain.focus_duration_minutes}min</span>
                </span>
                <span className="chain-stat">
                  <span className="chain-stat-label">辅助链</span>
                  <span className="chain-stat-value">{chain.auxiliary_delay_minutes}min</span>
                </span>
                <span className="chain-card-time">
                  {formatDate(chain.updated_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(raw: string): string {
  try {
    const d = new Date(raw + 'Z');
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return raw;
  }
}
