import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getChain, startFocusSession, getGlobalActiveFocusSession, getGlobalActiveReservationSession, getChainPrecedents, getChainReservationPrecedents } from '../lib/db';
import type { Chain, ChainPrecedent } from '../types';

export default function ChainDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [chain, setChain] = useState<Chain | null>(null);
  const [precedents, setPrecedents] = useState<ChainPrecedent[]>([]);
  const [reservationPrecedents, setReservationPrecedents] = useState<ChainPrecedent[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    const chainId = Number(id);
    Promise.all([getChain(chainId), getChainPrecedents(chainId), getChainReservationPrecedents(chainId)])
      .then(([c, p, rp]) => {
        setChain(c);
        setPrecedents(p);
        setReservationPrecedents(rp);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="page">
        <p className="placeholder-text">加载中…</p>
      </div>
    );
  }

  if (error || !chain) {
    return (
      <div className="page">
        <p className="placeholder-text">链不存在或加载失败</p>
        <button className="btn btn-secondary" onClick={() => navigate('/chains')}>
          ← 返回链列表
        </button>
      </div>
    );
  }

  const statusLabel =
    chain.status === 'active' ? '活跃' : '已归档';

  return (
    <div className="page">
      <button className="btn-back" onClick={() => navigate('/chains')}>
        ← 返回链列表
      </button>

      <div className="detail-header">
        <h2>{chain.name}</h2>
        <span className={`status-badge status-${chain.status}`}>
          {statusLabel}
        </span>
      </div>

      {chain.description && (
        <p className="detail-desc">{chain.description}</p>
      )}

      <div className="detail-grid">
        <div className="detail-item">
          <span className="detail-label">当前长度</span>
          <span className="detail-value">{chain.current_length} 节</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">历史最佳</span>
          <span className="detail-value">{chain.best_length} 节</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">默认专注时长</span>
          <span className="detail-value">{chain.focus_duration_minutes} 分钟</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">创建时间</span>
          <span className="detail-value">
            {new Date(chain.created_at + 'Z').toLocaleString('zh-CN')}
          </span>
        </div>
      </div>

      <div className="detail-actions">
        {recoveryMsg && <p className="recovery-msg">{recoveryMsg}</p>}
        <button
          className="btn btn-primary"
          disabled={starting}
          onClick={async () => {
            if (!chain) return;
            setStarting(true);
            setRecoveryMsg('');
            setError('');
            try {
              const globalFocus = await getGlobalActiveFocusSession();
              if (globalFocus) {
                setRecoveryMsg(
                  `已有进行中的正式任务（链「${globalFocus.chain_name}」），已为你恢复。`,
                );
                navigate(`/chains/${globalFocus.chain_id}/focus`);
                return;
              }

              const globalReservation = await getGlobalActiveReservationSession();
              if (globalReservation) {
                setError(
                  `当前已有进行中的预约（链「${globalReservation.chain_name}」），请先处理该预约。`,
                );
                return;
              }

              await startFocusSession(chain.id, chain.focus_duration_minutes);
              navigate(`/chains/${chain.id}/focus`);
            } catch (err) {
              setError(String(err));
            } finally {
              setStarting(false);
            }
          }}
        >
          {starting ? '正在启动…' : '开始正式任务'}
        </button>
        {error && <p className="action-error">{error}</p>}
      </div>

      <div className="precedents-section">
        <h3>主链判例</h3>
        {precedents.length === 0 ? (
          <p className="precedents-empty">暂无判例。完成一次判例化裁决后，判例会出现在这里。</p>
        ) : (
          <div className="precedents-list">
            {precedents.map((p) => (
              <div key={p.id} className="precedent-item">
                <div className="precedent-item-header">
                  <span className="precedent-item-title">{p.title}</span>
                  <span className="precedent-item-time">
                    {new Date(p.created_at + 'Z').toLocaleDateString('zh-CN')}
                  </span>
                </div>
                {p.description && (
                  <p className="precedent-item-desc">{p.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="precedents-section">
        <h3>预约判例</h3>
        {reservationPrecedents.length === 0 ? (
          <p className="precedents-empty">暂无预约判例。预约违约后选择判例化，判例会出现在这里。</p>
        ) : (
          <div className="precedents-list">
            {reservationPrecedents.map((p) => (
              <div key={p.id} className="precedent-item">
                <div className="precedent-item-header">
                  <span className="precedent-item-title">{p.title}</span>
                  <span className="precedent-item-time">
                    {new Date(p.created_at + 'Z').toLocaleDateString('zh-CN')}
                  </span>
                </div>
                {p.description && (
                  <p className="precedent-item-desc">{p.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
