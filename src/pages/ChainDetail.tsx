import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  expireReservationSession,
  fulfillReservationAndStartFocus,
  getChain,
  getChainPrecedents,
  getChainReservationPrecedents,
  getGlobalActiveFocusSession,
  getGlobalActiveReservationSession,
  startFocusSession,
  startReservationSession,
} from '../lib/db';
import EditChainForm from '../features/ctdp/EditChainForm';
import type {
  ActiveReservationSession,
  Chain,
  ChainPrecedent,
  FailReservationResetResult,
} from '../types';

type AuxiliaryPhase = 'idle' | 'countdown' | 'expired';

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDateTime(raw: string): string {
  return new Date(raw + 'Z').toLocaleString('zh-CN');
}

export default function ChainDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
  const [remaining, setRemaining] = useState(0);
  const [expiredResult, setExpiredResult] = useState<FailReservationResetResult | null>(null);
  const [error, setError] = useState('');
  const [warnMsg, setWarnMsg] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiringRef = useRef(false);

  const handleExpireAuxiliary = useCallback(async () => {
    if (!reservation || expiringRef.current) return;
    expiringRef.current = true;
    setError('');
    try {
      const result = await expireReservationSession(reservation.id);
      setExpiredResult(result);
      setReservation(null);
      setAuxiliaryPhase('expired');
      navigate(`/chains/${chainId}`, { replace: true });
    } catch (err) {
      setError(String(err));
    } finally {
      expiringRef.current = false;
    }
  }, [chainId, navigate, reservation]);

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
          const due = new Date(globalReservation.due_at + 'Z').getTime();
          const left = Math.max(0, Math.ceil((due - Date.now()) / 1000));

          if (left <= 0) {
            const expired = await expireReservationSession(globalReservation.id);
            if (cancelled) return;
            setExpiredResult(expired);
            setReservation(null);
            setRemaining(0);
            setAuxiliaryPhase('expired');
            return;
          }

          setReservation(globalReservation);
          setRemaining(left);
          setAuxiliaryPhase('countdown');
        } else {
          setReservation(null);
          setRemaining(0);
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
    if (auxiliaryPhase !== 'countdown') return;

    timerRef.current = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [auxiliaryPhase]);

  useEffect(() => {
    if (remaining !== 0 || auxiliaryPhase !== 'countdown') return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    handleExpireAuxiliary();
  }, [remaining, auxiliaryPhase, handleExpireAuxiliary]);

  async function enterMainFromReservation(reservationId: number) {
    const result = await fulfillReservationAndStartFocus(reservationId);
    setHasActiveFocusOnThisChain(true);
    navigate(`/chains/${result.chain_id}/focus`);
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
    setExpiredResult(null);
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

      const created = await startReservationSession(chain.id);
      const due = new Date(created.due_at + 'Z').getTime();
      const left = Math.max(1, Math.ceil((due - Date.now()) / 1000));
      setReservation(created);
      setRemaining(left);
      setAuxiliaryPhase('countdown');
      navigate(`/chains/${chain.id}?mode=aux`, { replace: true });
    } catch (err) {
      setError(String(err));
    } finally {
      setStartingAuxiliary(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="placeholder-text">加载中...</p>
      </div>
    );
  }

  if (!chain) {
    return (
      <div className="page">
        <p className="placeholder-text">{error || '链不存在或加载失败'}</p>
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

  const mainButtonLabel = auxiliaryPhase === 'countdown' ? '进入主链' : '启动主链';

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
            辅助链是主链的预约窗口。倒计时结束前进入主链即履约成功；窗口结束仍未进入主链，则自动记录辅助链失败。
          </p>
        </div>
        <div className="protocol-grid">
          <ProtocolFact label="预约时间" value={`${chain.auxiliary_delay_minutes} 分钟`} />
          <ProtocolFact label="完成条件" value={chain.auxiliary_completion_condition} />
        </div>
      </div>

      <div className="detail-actions protocol-actions">
        {warnMsg && <p className="action-warn">{warnMsg}</p>}
        {error && <p className="action-error">{error}</p>}

        {hasActiveFocusOnThisChain ? (
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chain.id}/focus`)}>
            回到神圣座位
          </button>
        ) : (
          <button className="btn btn-primary" disabled={startingMain} onClick={handleStartMain}>
            {startingMain ? '启动中...' : mainButtonLabel}
          </button>
        )}

        <button
          className="btn btn-secondary"
          disabled={startingAuxiliary || auxiliaryPhase === 'countdown' || hasActiveFocusOnThisChain}
          onClick={handleStartAuxiliary}
        >
          {startingAuxiliary ? '启动中...' : '启动辅助链'}
        </button>

        <button className="btn btn-secondary" onClick={() => setEditing(true)}>
          编辑协议
        </button>
      </div>

      <AuxiliaryRuntime
        phase={auxiliaryPhase}
        chain={chain}
        reservation={reservation}
        remaining={remaining}
        expiredResult={expiredResult}
        onEnterMain={handleStartMain}
      />

      <div className="precedents-section">
        <h3>协议边界</h3>
        {protocolBoundaries.length === 0 ? (
          <p className="precedents-empty">
            暂无判例。启动前默认边界保持严格；完成一次裁决并判例化后，例外会显示在这里。
          </p>
        ) : (
          <div className="precedents-list">
            {protocolBoundaries.map((item) => (
              <div key={`${item.source}-${item.id}`} className="precedent-item">
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
              </div>
            ))}
          </div>
        )}
      </div>
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

function AuxiliaryRuntime({
  phase,
  chain,
  reservation,
  remaining,
  expiredResult,
  onEnterMain,
}: {
  phase: AuxiliaryPhase;
  chain: Chain;
  reservation: ActiveReservationSession | null;
  remaining: number;
  expiredResult: FailReservationResetResult | null;
  onEnterMain: () => void;
}) {
  if (phase === 'idle') return null;

  if (phase === 'expired') {
    const chainUpdate = expiredResult?.chain ?? chain;
    return (
      <div className="auxiliary-runtime">
        <h3>辅助链已自动失败</h3>
        <p className="ruling-result-desc">
          辅助链未在预约窗口内进入主链，已记录失败。主链 {chainUpdate.name} 的长度不受影响。
        </p>
        <div className="focus-chain-update">
          <span className="focus-chain-label">{chainUpdate.name}</span>
          <div className="focus-chain-numbers">
            <span className="focus-chain-item">
              当前 <strong>{chainUpdate.current_length}</strong> 节
            </span>
            <span className="focus-chain-item">
              最佳 <strong>{chainUpdate.best_length}</strong> 节
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!reservation) return null;

  return (
    <div className="auxiliary-runtime">
      <div className="res-session-header">
        <span className="res-chain-name">{chain.name} / 辅助链预约中</span>
        <span className="res-due-label">窗口结束 {formatDateTime(reservation.due_at)}</span>
      </div>
      <div className="focus-timer">
        <span className="focus-time">{formatTime(remaining)}</span>
        <span className="focus-status">预约窗口</span>
      </div>
      <div className="res-actions">
        <button className="btn btn-primary btn-large" onClick={onEnterMain}>
          进入主链
        </button>
        <p className="focus-hint" style={{ textAlign: 'center' }}>
          在倒计时结束前进入主链即视为辅助链履约成功。
        </p>
      </div>
    </div>
  );
}
