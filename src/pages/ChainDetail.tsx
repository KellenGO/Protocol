import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  expireReservationSession,
  failReservationSessionPrecedent,
  failReservationSessionReset,
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
import { FAILURE_DEBUG_CATEGORIES } from '../features/ctdp/protocolOptions';
import type {
  ActiveReservationSession,
  Chain,
  ChainPrecedent,
  FailReservationPrecedentResult,
  FailReservationResetResult,
  ProtocolPrecedent,
} from '../types';

type AuxiliaryPhase = 'idle' | 'countdown' | 'confirming' | 'ruling' | 'expired';

type AuxiliaryDoneResult =
  | { kind: 'failed_reset'; data: FailReservationResetResult }
  | { kind: 'failed_precedent'; data: FailReservationPrecedentResult };

const behaviorTypes = [
  '通讯 / 消息打断',
  '手机 / 娱乐诱惑',
  '外部事件',
  '生理需求',
  '环境变化',
  '任务定义不清',
  '身体状态不佳',
  '紧急情况',
  '其他',
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDateTime(raw: string): string {
  return new Date(raw + 'Z').toLocaleString('zh-CN');
}

function reservationTargetTime(reservation: ActiveReservationSession): number {
  const target = reservation.phase === 'confirming'
    ? reservation.confirmation_due_at ?? reservation.due_at
    : reservation.due_at;
  return new Date(target + 'Z').getTime();
}

function auxiliaryPhaseFromReservation(reservation: ActiveReservationSession): AuxiliaryPhase {
  if (reservation.phase === 'pending_ruling') return 'ruling';
  return reservation.phase === 'confirming' ? 'confirming' : 'countdown';
}

function reservationFromFailure(result: FailReservationResetResult): ActiveReservationSession {
  return {
    id: result.session.id,
    chain_id: result.session.chain_id,
    created_at: result.session.created_at,
    due_at: result.session.due_at,
    confirmation_due_at: result.session.confirmation_due_at,
    trigger_action: result.session.trigger_action,
    completion_condition: result.session.completion_condition,
    phase: 'pending_ruling',
  };
}

function resolveBehavior(behaviorType: string, customBehavior: string): string {
  if (behaviorType === '其他') return customBehavior.trim();
  return behaviorType;
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
  const [remaining, setRemaining] = useState(0);
  const [expiredResult, setExpiredResult] = useState<FailReservationResetResult | null>(null);
  const [auxiliaryDoneResult, setAuxiliaryDoneResult] = useState<AuxiliaryDoneResult | null>(null);
  const [behaviorType, setBehaviorType] = useState(behaviorTypes[0]);
  const [customBehavior, setCustomBehavior] = useState('');
  const [debugCategory, setDebugCategory] = useState(FAILURE_DEBUG_CATEGORIES[0]);
  const [debugNote, setDebugNote] = useState('');
  const [rulingError, setRulingError] = useState('');
  const [selectedPrecedent, setSelectedPrecedent] = useState<ProtocolPrecedent | null>(null);
  const [precedentTitle, setPrecedentTitle] = useState('');
  const [precedentDescription, setPrecedentDescription] = useState('');
  const [precedentWorking, setPrecedentWorking] = useState(false);
  const [precedentError, setPrecedentError] = useState('');
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
      setReservation(reservationFromFailure(result));
      setAuxiliaryPhase('ruling');
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
          const phase = auxiliaryPhaseFromReservation(globalReservation);
          const target = reservationTargetTime(globalReservation);
          const left = Math.max(0, Math.ceil((target - Date.now()) / 1000));

          if (left <= 0 && phase === 'confirming') {
            const expired = await expireReservationSession(globalReservation.id);
            if (cancelled) return;
            setExpiredResult(expired);
            setReservation(reservationFromFailure(expired));
            setRemaining(0);
            setAuxiliaryPhase('ruling');
            return;
          }

          setReservation(globalReservation);
          setRemaining(left);
          setAuxiliaryPhase(phase);
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
    const precedentId = searchParams.get('precedent');
    if (!precedentId) return;
    const id = Number(precedentId);
    if (!Number.isFinite(id)) return;
    openPrecedent(id);
  }, [searchParams]);

  useEffect(() => {
    if (auxiliaryPhase !== 'countdown' && auxiliaryPhase !== 'confirming') return;

    timerRef.current = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [auxiliaryPhase]);

  useEffect(() => {
    if (remaining !== 0) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (auxiliaryPhase === 'countdown' && reservation) {
      const confirmationTarget = new Date((reservation.confirmation_due_at ?? reservation.due_at) + 'Z').getTime();
      setRemaining(Math.max(0, Math.ceil((confirmationTarget - Date.now()) / 1000)));
      setReservation({ ...reservation, phase: 'confirming' });
      setAuxiliaryPhase('confirming');
      return;
    }
    if (auxiliaryPhase === 'confirming') handleExpireAuxiliary();
  }, [remaining, auxiliaryPhase, handleExpireAuxiliary, reservation]);

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

  function getBehavior(): string | null {
    const behavior = resolveBehavior(behaviorType, customBehavior);
    if (!behavior) {
      setRulingError('请填写自定义争议行为。');
      return null;
    }
    setRulingError('');
    return behavior;
  }

  async function handleAuxiliaryResetRuling() {
    const behavior = getBehavior();
    if (!reservation || !behavior) return;
    try {
      const result = await failReservationSessionReset(
        reservation.id,
        behavior,
        debugCategory,
        debugNote,
      );
      setAuxiliaryDoneResult({ kind: 'failed_reset', data: result });
      setChain(result.chain);
      setReservation(null);
      setAuxiliaryPhase('expired');
      await reloadPrecedents();
    } catch (err) {
      setRulingError(String(err));
    }
  }

  async function handleAuxiliaryPrecedentRuling() {
    const behavior = getBehavior();
    if (!reservation || !behavior) return;
    try {
      const result = await failReservationSessionPrecedent(
        reservation.id,
        { title: behavior, description: '' },
        debugCategory,
        debugNote,
      );
      setAuxiliaryDoneResult({ kind: 'failed_precedent', data: result });
      setChain(result.chain);
      setReservation(null);
      setAuxiliaryPhase('expired');
      await reloadPrecedents();
    } catch (err) {
      setRulingError(String(err));
    }
  }

  async function openPrecedent(id: number) {
    setPrecedentWorking(true);
    setPrecedentError('');
    try {
      const item = await getPrecedent(id);
      setSelectedPrecedent(item);
      setPrecedentTitle(item.title);
      setPrecedentDescription(item.description);
    } catch (_err) {
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
      const target = reservationTargetTime(created);
      const left = Math.max(1, Math.ceil((target - Date.now()) / 1000));
      setReservation(created);
      setRemaining(left);
      setAuxiliaryPhase(auxiliaryPhaseFromReservation(created));
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
        {warnMsg && <p className="action-warn">{warnMsg}</p>}
        {error && <p className="action-error">{error}</p>}

        {hasActiveFocusOnThisChain ? (
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chain.id}/focus`)}>
            回到神圣座位
          </button>
        ) : auxiliaryPhase === 'ruling' ? (
          <button className="btn btn-primary" onClick={() => document.getElementById('auxiliary-ruling')?.scrollIntoView({ behavior: 'smooth' })}>
            处理辅助链裁决
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

      <AuxiliaryRuntime
        phase={auxiliaryPhase}
        chain={chain}
        reservation={reservation}
        remaining={remaining}
        expiredResult={expiredResult}
        doneResult={auxiliaryDoneResult}
        behaviorType={behaviorType}
        customBehavior={customBehavior}
        debugCategory={debugCategory}
        debugNote={debugNote}
        rulingError={rulingError}
        setBehaviorType={setBehaviorType}
        setCustomBehavior={setCustomBehavior}
        setDebugCategory={setDebugCategory}
        setDebugNote={setDebugNote}
        onResetRuling={handleAuxiliaryResetRuling}
        onPrecedentRuling={handleAuxiliaryPrecedentRuling}
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
              <button key={`${item.source}-${item.id}`} className="precedent-item precedent-button" onClick={() => openPrecedent(item.id)}>
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
          <p className="review-precedent-notice">{precedentError}</p>
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

function AuxiliaryRuntime({
  phase,
  chain,
  reservation,
  remaining,
  expiredResult,
  doneResult,
  behaviorType,
  customBehavior,
  debugCategory,
  debugNote,
  rulingError,
  setBehaviorType,
  setCustomBehavior,
  setDebugCategory,
  setDebugNote,
  onResetRuling,
  onPrecedentRuling,
  onEnterMain,
}: {
  phase: AuxiliaryPhase;
  chain: Chain;
  reservation: ActiveReservationSession | null;
  remaining: number;
  expiredResult: FailReservationResetResult | null;
  doneResult: AuxiliaryDoneResult | null;
  behaviorType: string;
  customBehavior: string;
  debugCategory: string;
  debugNote: string;
  rulingError: string;
  setBehaviorType: (value: string) => void;
  setCustomBehavior: (value: string) => void;
  setDebugCategory: (value: string) => void;
  setDebugNote: (value: string) => void;
  onResetRuling: () => void;
  onPrecedentRuling: () => void;
  onEnterMain: () => void;
}) {
  if (phase === 'idle') return null;

  if (phase === 'expired') {
    const chainUpdate = doneResult?.data.chain ?? expiredResult?.chain ?? chain;
    const precedent = doneResult?.kind === 'failed_precedent' ? doneResult.data.precedent : null;
    return (
      <div className="auxiliary-runtime">
        <h3>{precedent ? '辅助链判例化完成' : '辅助链裁决完成'}</h3>
        <p className="ruling-result-desc">
          {precedent
            ? `新的辅助链边界已写入：${precedent.title}。主链和辅助链长度保持不变。`
            : `辅助链已判定违约。主链 ${chainUpdate.name} 的长度不受影响，辅助链连续长度已清零。`}
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
          <div className="focus-chain-numbers">
            <span className="focus-chain-item">
              辅助当前 <strong>{chainUpdate.auxiliary_current_length}</strong> 节
            </span>
            <span className="focus-chain-item">
              辅助最佳 <strong>{chainUpdate.auxiliary_best_length}</strong> 节
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'ruling') {
    return (
      <div id="auxiliary-ruling" className="auxiliary-runtime ruling-panel-wide">
        <h3>辅助链裁决</h3>
        <p className="ruling-desc">
          辅助链确认窗口已经结束。现在必须把本次未履约判定为违约，或写成辅助链判例，成为未来协议边界的一部分。
        </p>

        <div className="ruling-form">
          <label className="form-field">
            <span>争议行为类型</span>
            <select className="form-select" value={behaviorType} onChange={(e) => setBehaviorType(e.target.value)}>
              {behaviorTypes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          {behaviorType === '其他' && (
            <label className="form-field">
              <span>自定义争议行为</span>
              <input
                value={customBehavior}
                onChange={(e) => setCustomBehavior(e.target.value)}
                placeholder="简短描述争议行为"
              />
            </label>
          )}
        </div>

        <div className="debug-fields">
          <label className="form-field">
            <span>失败调试分类</span>
            <select className="form-select" value={debugCategory} onChange={(e) => setDebugCategory(e.target.value)}>
              {FAILURE_DEBUG_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>调试备注</span>
            <textarea
              value={debugNote}
              onChange={(e) => setDebugNote(e.target.value)}
              placeholder="可选：记录本次预约失败的真实上下文"
            />
          </label>
        </div>

        {rulingError && <p className="form-error">{rulingError}</p>}

        <div className="ruling-options">
          <button className="ruling-option ruling-reset" onClick={onResetRuling}>
            <span className="ruling-option-title">判定违约：辅助链断裂并清零</span>
            <span className="ruling-option-consequence">主链长度不变；本次事件写入协议时间线。</span>
          </button>
          <button className="ruling-option ruling-precedent" onClick={onPrecedentRuling}>
            <span className="ruling-option-title">判例化：写入辅助链边界</span>
            <span className="ruling-option-consequence">辅助链不清零，未来同类情况默认允许。</span>
          </button>
        </div>
      </div>
    );
  }

  if (!reservation) return null;

  return (
    <div className="auxiliary-runtime">
      <div className="res-session-header">
        <span className="res-chain-name">
          {chain.name} / {phase === 'confirming' ? '辅助链待确认' : '辅助链预约中'}
        </span>
        <span className="res-due-label">
          {phase === 'confirming'
            ? `确认截止 ${formatDateTime(reservation.confirmation_due_at ?? reservation.due_at)}`
            : `窗口结束 ${formatDateTime(reservation.due_at)}`}
        </span>
      </div>
      <div className="focus-timer">
        <span className="focus-time">{formatTime(remaining)}</span>
        <span className="focus-status">{phase === 'confirming' ? '确认窗口' : '预约窗口'}</span>
      </div>
      <div className="res-actions">
        <button className="btn btn-primary btn-large" onClick={onEnterMain}>
          进入主链
        </button>
        <p className="focus-hint" style={{ textAlign: 'center' }}>
          {phase === 'confirming'
            ? '第二预约信号已触发；确认窗口结束前进入主链仍视为履约成功。'
            : '在预约窗口结束前进入主链即视为辅助链履约成功。'}
        </p>
      </div>
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
    <div className="precedent-detail-panel">
      <div className="precedent-detail-header">
        <div>
          <span className={`formula-status status-${precedent.status === 'active' ? 'active' : 'inactive'}`}>
            {precedent.status === 'active' ? '生效中' : '已废止'}
          </span>
          <h3>判例详情</h3>
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
