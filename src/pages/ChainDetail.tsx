import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  fulfillReservationAndStartFocus,
  getChain,
  getChainPrecedents,
  getChainReservationPrecedents,
  getGlobalActiveFocusSession,
  getGlobalActiveReservationSession,
  getPrecedent,
  retirePrecedent,
  startFocusSession,
  startReservationSession,
  updatePrecedent,
} from '../lib/db';
import EditChainForm from '../features/ctdp/EditChainForm';
import type {
  ActiveReservationSession,
  Chain,
  ChainPrecedent,
  ProtocolPrecedent,
} from '../types';

type AuxiliaryPhase = 'idle' | 'countdown' | 'confirming' | 'ruling';

function formatDateTime(raw: string): string {
  return new Date(raw + 'Z').toLocaleString('zh-CN');
}

function auxiliaryPhaseFromReservation(reservation: ActiveReservationSession): AuxiliaryPhase {
  if (reservation.phase === 'pending_ruling') return 'ruling';
  return reservation.phase === 'confirming' ? 'confirming' : 'countdown';
}

export default function ChainDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const chainId = Number(id);

  const [chain, setChain] = useState<Chain | null>(null);
  const [precedents, setPrecedents] = useState<ChainPrecedent[]>([]);
  const [reservationPrecedents, setReservationPrecedents] = useState<ChainPrecedent[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingMain, setStartingMain] = useState(false);
  const [startingAuxiliary, setStartingAuxiliary] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hasActiveFocusOnThisChain, setHasActiveFocusOnThisChain] = useState(false);
  const [auxiliaryPhase, setAuxiliaryPhase] = useState<AuxiliaryPhase>('idle');
  const [reservation, setReservation] = useState<ActiveReservationSession | null>(null);
  const [selectedPrecedent, setSelectedPrecedent] = useState<ProtocolPrecedent | null>(null);
  const [precedentTitle, setPrecedentTitle] = useState('');
  const [precedentDescription, setPrecedentDescription] = useState('');
  const [precedentWorking, setPrecedentWorking] = useState(false);
  const [precedentError, setPrecedentError] = useState('');
  const [error, setError] = useState('');
  const [warnMsg, setWarnMsg] = useState('');

  useEffect(() => {
    if (!chainId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      setWarnMsg('');
      try {
        const [c, p, rp, globalFocus, globalReservation] = await Promise.all([
          getChain(chainId),
          getChainPrecedents(chainId),
          getChainReservationPrecedents(chainId),
          getGlobalActiveFocusSession(),
          getGlobalActiveReservationSession(),
        ]);
        if (cancelled) return;

        setChain(c);
        setPrecedents(p);
        setReservationPrecedents(rp);
        setHasActiveFocusOnThisChain(globalFocus !== null && globalFocus.chain_id === chainId);

        if (globalReservation && globalReservation.chain_id === chainId) {
          const phase = auxiliaryPhaseFromReservation(globalReservation);
          setReservation(globalReservation);
          setAuxiliaryPhase(phase);
        } else {
          setReservation(null);
          setAuxiliaryPhase('idle');
          if (globalReservation) {
            setWarnMsg(`已有辅助链预约中：${globalReservation.chain_name}`);
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  useEffect(() => {
    const precedentId = searchParams.get('precedent');
    if (!precedentId) return;
    const id = Number(precedentId);
    if (!Number.isFinite(id)) return;
    openPrecedent(id);
  }, [searchParams]);

  async function enterMainFromReservation(reservationId: number) {
    const result = await fulfillReservationAndStartFocus(reservationId);
    setHasActiveFocusOnThisChain(true);
    navigate(`/chains/${result.chain_id}/focus`);
  }

  async function reloadPrecedents() {
    const [p, rp] = await Promise.all([
      getChainPrecedents(chainId),
      getChainReservationPrecedents(chainId),
    ]);
    setPrecedents(p);
    setReservationPrecedents(rp);
  }

  async function openPrecedent(id: number) {
    setPrecedentWorking(true);
    setPrecedentError('');
    try {
      const item = await getPrecedent(id);
      setSelectedPrecedent(item);
      setPrecedentTitle(item.title);
      setPrecedentDescription(item.description);
    } catch {
      setPrecedentError('判例不存在或已被删除。');
      setSelectedPrecedent(null);
    } finally {
      setPrecedentWorking(false);
    }
  }

  async function handleUpdatePrecedent() {
    if (!selectedPrecedent) return;
    setPrecedentWorking(true);
    try {
      const updated = await updatePrecedent(selectedPrecedent.id, {
        title: precedentTitle,
        description: precedentDescription,
      });
      setSelectedPrecedent(updated);
      setPrecedentTitle(updated.title);
      setPrecedentDescription(updated.description);
      await reloadPrecedents();
    } catch (err) {
      setError(String(err));
    } finally {
      setPrecedentWorking(false);
    }
  }

  async function handleRetirePrecedent() {
    if (!selectedPrecedent) return;
    const confirmed = window.confirm(
      '废止后，该判例不再作为活跃协议边界显示，但历史记录仍会保留。确认废止？',
    );
    if (!confirmed) return;
    setPrecedentWorking(true);
    try {
      const retired = await retirePrecedent(selectedPrecedent.id);
      setSelectedPrecedent(retired);
      await reloadPrecedents();
    } catch (err) {
      setError(String(err));
    } finally {
      setPrecedentWorking(false);
    }
  }

  async function handleStartMain() {
    if (!chain) return;
    setStartingMain(true);
    setWarnMsg('');
    setError('');
    try {
      const globalFocus = await getGlobalActiveFocusSession();
      if (globalFocus) {
        setWarnMsg(`已有神圣座位被占用：${globalFocus.chain_name}`);
        return;
      }

      if (reservation) {
        await enterMainFromReservation(reservation.id);
        return;
      }

      const globalReservation = await getGlobalActiveReservationSession();
      if (globalReservation) {
        if (globalReservation.chain_id === chain.id) {
          await enterMainFromReservation(globalReservation.id);
          return;
        }
        setError(`当前已有辅助链预约中：${globalReservation.chain_name}。请先处理该辅助链。`);
        return;
      }

      await startFocusSession(chain.id);
      setHasActiveFocusOnThisChain(true);
      navigate(`/chains/${chain.id}/focus`);
    } catch (err) {
      setError(String(err));
    } finally {
      setStartingMain(false);
    }
  }

  async function handleStartAuxiliary() {
    if (!chain) return;
    setStartingAuxiliary(true);
    setWarnMsg('');
    setError('');
    try {
      const globalReservation = await getGlobalActiveReservationSession();
      if (globalReservation) {
        setError(`当前已有辅助链预约中：${globalReservation.chain_name}。`);
        return;
      }

      const globalFocus = await getGlobalActiveFocusSession();
      if (globalFocus) {
        setError(`当前已有神圣座位被占用：${globalFocus.chain_name}。`);
        return;
      }

      await startReservationSession(chain.id);
      navigate(`/chains/${chain.id}/auxiliary`);
    } catch (err) {
      setError(String(err));
    } finally {
      setStartingAuxiliary(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="placeholder-text" role="status" aria-live="polite">加载中...</p>
      </div>
    );
  }

  if (!chain) {
    return (
      <div className="page">
        <p className="placeholder-text" role="alert">{error || '链不存在或加载失败'}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/chains')}>
          返回链列表
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="page">
        <button className="btn-back" onClick={() => setEditing(false)}>
          返回详情
        </button>
        <EditChainForm
          chain={chain}
          onUpdated={(updated) => {
            setChain(updated);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const statusLabel = chain.status === 'active' ? '活跃' : '已归档';
  const protocolBoundaries = [
    ...precedents.map((item) => ({ ...item, source: '主链' })),
    ...reservationPrecedents.map((item) => ({ ...item, source: '辅助链' })),
  ];

  const mainButtonLabel = auxiliaryPhase === 'countdown' || auxiliaryPhase === 'confirming' ? '进入主链' : '启动主链';

  return (
    <div className="page">
      <button className="btn-back" onClick={() => navigate('/chains')}>
        返回链列表
      </button>

      <div className="detail-header">
        <h2>{chain.name}</h2>
        <span className={`status-badge status-${chain.status}`}>{statusLabel}</span>
      </div>

      {chain.description && <p className="detail-desc">{chain.description}</p>}

      <div className="sacred-seat-panel protocol-seat-panel">
        <div className="sacred-seat-main">
          <span className="sacred-seat-kicker">神圣座位</span>
          <h3>{chain.trigger_action}</h3>
          <p>
            按下“启动主链”后，这个触发动作就占用神圣座位。本次协议只能完成，或进入裁决。
          </p>
        </div>
        <div className="protocol-grid">
          <ProtocolFact label="当前链长" value={`${chain.current_length} 节`} />
          <ProtocolFact label="持续时间" value={`${chain.focus_duration_minutes} 分钟`} />
          <ProtocolFact label="完成条件" value={chain.completion_condition} />
        </div>
      </div>

      <div className="auxiliary-panel">
        <div className="auxiliary-copy">
          <span className="sacred-seat-kicker">辅助链</span>
          <h3>{chain.auxiliary_trigger_action}</h3>
          <p>
            辅助链是主链的预约窗口。倒计时结束前进入主链即履约成功；确认窗口结束仍未进入主链，则进入辅助链裁决。
          </p>
        </div>
        <div className="protocol-grid">
          <ProtocolFact label="预约时间" value={`${chain.auxiliary_delay_minutes} 分钟`} />
          <ProtocolFact label="完成条件" value={chain.auxiliary_completion_condition} />
          <ProtocolFact label="当前辅助链" value={`${chain.auxiliary_current_length} 节`} />
          <ProtocolFact label="最佳辅助链" value={`${chain.auxiliary_best_length} 节`} />
        </div>
      </div>

      <div className="detail-actions protocol-actions">
        {warnMsg && <p className="action-warn" role="status">{warnMsg}</p>}
        {error && <p className="action-error" role="alert">{error}</p>}

        {hasActiveFocusOnThisChain ? (
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chain.id}/focus`)} aria-label={`回到主链 ${chain.name} 的神圣座位`}>
            回到神圣座位
          </button>
        ) : auxiliaryPhase !== 'idle' ? (
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chain.id}/auxiliary`)} aria-label={`进入主链 ${chain.name} 的辅助链窗口`}>
            {auxiliaryPhase === 'ruling' ? '处理辅助链裁决' : '进入辅助链'}
          </button>
        ) : (
          <button className="btn btn-primary" disabled={startingMain} onClick={handleStartMain}>
            {startingMain ? '启动中...' : mainButtonLabel}
          </button>
        )}

        <button
          className="btn btn-secondary"
          disabled={startingAuxiliary || auxiliaryPhase === 'countdown' || auxiliaryPhase === 'confirming' || auxiliaryPhase === 'ruling' || hasActiveFocusOnThisChain}
          onClick={handleStartAuxiliary}
        >
          {startingAuxiliary ? '启动中...' : '启动辅助链'}
        </button>

        <button className="btn btn-secondary" onClick={() => setEditing(true)}>
          编辑协议
        </button>
      </div>

      <div className="precedents-section" aria-labelledby="protocol-boundary-heading">
        <h3 id="protocol-boundary-heading">协议边界</h3>
        {protocolBoundaries.length === 0 ? (
          <p className="precedents-empty">
            暂无判例。启动前默认边界保持严格；完成一次裁决并判例化后，例外会显示在这里。
          </p>
        ) : (
          <div className="precedents-list">
            {protocolBoundaries.map((item) => (
              <button
                key={`${item.source}-${item.id}`}
                className="precedent-item precedent-button"
                onClick={() => openPrecedent(item.id)}
                aria-label={`查看${item.source}判例：${item.title}`}
              >
                <div className="precedent-item-header">
                  <span className="precedent-item-title">
                    <span className="boundary-source">{item.source}</span>
                    {item.title}
                  </span>
                  <span className="precedent-item-time">
                    {formatDateTime(item.created_at)}
                  </span>
                </div>
                {item.description && <p className="precedent-item-desc">{item.description}</p>}
              </button>
            ))}
          </div>
        )}
      </div>

      {precedentError && (
        <div className="precedents-section">
          <p className="review-precedent-notice" role="alert">{precedentError}</p>
        </div>
      )}
      <PrecedentPanel
        precedent={selectedPrecedent}
        title={precedentTitle}
        description={precedentDescription}
        working={precedentWorking}
        setTitle={setPrecedentTitle}
        setDescription={setPrecedentDescription}
        onClose={() => { setSelectedPrecedent(null); setPrecedentError(''); }}
        onSave={handleUpdatePrecedent}
        onRetire={handleRetirePrecedent}
      />
    </div>
  );
}

function ProtocolFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="protocol-fact">
      <span className="detail-label">{label}</span>
      <span className="protocol-fact-value">{value}</span>
    </div>
  );
}

function PrecedentPanel({
  precedent,
  title,
  description,
  working,
  setTitle,
  setDescription,
  onClose,
  onSave,
  onRetire,
}: {
  precedent: ProtocolPrecedent | null;
  title: string;
  description: string;
  working: boolean;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onRetire: () => void;
}) {
  if (!precedent) return null;

  const scopeLabel = precedent.scope === 'main_chain' ? '主链' : '辅助链';
  const sourceLabel = precedent.created_from_session_type === 'focus' ? '神圣座位' : '辅助链';

  return (
    <div className="precedent-detail-panel" role="region" aria-labelledby="precedent-detail-heading">
      <div className="precedent-detail-header">
        <div>
          <span className={`formula-status status-${precedent.status === 'active' ? 'active' : 'inactive'}`}>
            {precedent.status === 'active' ? '生效中' : '已废止'}
          </span>
          <h3 id="precedent-detail-heading">判例详情</h3>
        </div>
        <button className="btn btn-secondary" onClick={onClose}>
          关闭
        </button>
      </div>

      <div className="precedent-detail-grid">
        <ProtocolFact label="作用域" value={scopeLabel} />
        <ProtocolFact label="来源" value={`${sourceLabel} #${precedent.created_from_session_id ?? '-'}`} />
        <ProtocolFact label="创建时间" value={formatDateTime(precedent.created_at)} />
        <ProtocolFact label="更新时间" value={precedent.updated_at ? formatDateTime(precedent.updated_at) : '-'} />
      </div>

      <label className="form-field">
        <span>判例标题</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={precedent.status === 'retired'} />
      </label>
      <label className="form-field">
        <span>描述</span>
        <textarea
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={precedent.status === 'retired'}
          placeholder="记录这个判例允许什么，以及边界在哪里"
        />
      </label>

      <div className="precedent-detail-actions">
        <button className="btn btn-primary" disabled={working || precedent.status === 'retired'} onClick={onSave}>
          {working ? '保存中...' : '保存判例'}
        </button>
        <button className="btn-danger-outline compact-btn" disabled={working || precedent.status === 'retired'} onClick={onRetire}>
          废止判例
        </button>
      </div>
    </div>
  );
}
