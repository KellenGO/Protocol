import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  expireReservationSession,
  failReservationSessionPrecedent,
  failReservationSessionReset,
  fulfillReservationAndStartFocus,
  getChain,
  getGlobalActiveReservationSession,
} from '../lib/db';
import { FAILURE_DEBUG_CATEGORIES } from '../features/ctdp/protocolOptions';
import type {
  ActiveReservationSession,
  Chain,
  FailReservationPrecedentResult,
  FailReservationResetResult,
} from '../types';

type Phase = 'loading' | 'countdown' | 'confirming' | 'ruling' | 'done' | 'empty';

type DoneResult =
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

function phaseFromReservation(reservation: ActiveReservationSession): Phase {
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

export default function AuxiliarySessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const chainId = Number(id);

  const [chain, setChain] = useState<Chain | null>(null);
  const [reservation, setReservation] = useState<ActiveReservationSession | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [behaviorType, setBehaviorType] = useState(behaviorTypes[0]);
  const [customBehavior, setCustomBehavior] = useState('');
  const [debugCategory, setDebugCategory] = useState(FAILURE_DEBUG_CATEGORIES[0]);
  const [debugNote, setDebugNote] = useState('');
  const [rulingError, setRulingError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiringRef = useRef(false);

  const expireAuxiliary = useCallback(async () => {
    if (!reservation || expiringRef.current) return;
    expiringRef.current = true;
    setError('');
    try {
      const result = await expireReservationSession(reservation.id);
      setReservation(reservationFromFailure(result));
      setPhase('ruling');
    } catch (err) {
      setError(String(err));
    } finally {
      expiringRef.current = false;
    }
  }, [reservation]);

  useEffect(() => {
    if (!chainId) return;
    let cancelled = false;

    async function load() {
      try {
        const [loadedChain, activeReservation] = await Promise.all([
          getChain(chainId),
          getGlobalActiveReservationSession(),
        ]);
        if (cancelled) return;

        setChain(loadedChain);

        if (!activeReservation || activeReservation.chain_id !== chainId) {
          setPhase('empty');
          setReservation(null);
          return;
        }

        const nextPhase = phaseFromReservation(activeReservation);
        const target = reservationTargetTime(activeReservation);
        const left = Math.max(0, Math.ceil((target - Date.now()) / 1000));

        setReservation(activeReservation);
        setRemaining(left);
        setPhase(nextPhase);
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setPhase('empty');
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'confirming') return;

    timerRef.current = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  useEffect(() => {
    if (remaining !== 0) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (phase === 'countdown' && reservation) {
      const confirmationTarget = new Date((reservation.confirmation_due_at ?? reservation.due_at) + 'Z').getTime();
      setRemaining(Math.max(0, Math.ceil((confirmationTarget - Date.now()) / 1000)));
      setReservation({ ...reservation, phase: 'confirming' });
      setPhase('confirming');
      return;
    }
    if (phase === 'confirming') expireAuxiliary();
  }, [remaining, phase, expireAuxiliary, reservation]);

  async function enterMainFromReservation() {
    if (!reservation) return;
    try {
      const result = await fulfillReservationAndStartFocus(reservation.id);
      navigate(`/chains/${result.chain_id}/focus`);
    } catch (err) {
      setError(String(err));
    }
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

  async function handleResetRuling() {
    const behavior = getBehavior();
    if (!reservation || !behavior) return;
    try {
      const result = await failReservationSessionReset(
        reservation.id,
        behavior,
        debugCategory,
        debugNote,
      );
      setDoneResult({ kind: 'failed_reset', data: result });
      setChain(result.chain);
      setReservation(null);
      setPhase('done');
    } catch (err) {
      setRulingError(String(err));
    }
  }

  async function handlePrecedentRuling() {
    const behavior = getBehavior();
    if (!reservation || !behavior) return;
    try {
      const result = await failReservationSessionPrecedent(
        reservation.id,
        { title: behavior, description: '' },
        debugCategory,
        debugNote,
      );
      setDoneResult({ kind: 'failed_precedent', data: result });
      setChain(result.chain);
      setReservation(null);
      setPhase('done');
    } catch (err) {
      setRulingError(String(err));
    }
  }

  if (phase === 'loading') {
    return (
      <div className="page">
        <p className="placeholder-text" role="status" aria-live="polite">加载辅助链...</p>
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

  return (
    <div className="page session-page auxiliary-session-page">
      <div className="session-header">
        <div>
          <span className="session-kicker">辅助链窗口</span>
          <h2>{chain.name}</h2>
        </div>
        <span className="session-state">{sessionStateLabel(phase)}</span>
      </div>

      {error && <p className="action-error" role="alert">{error}</p>}

      {phase === 'empty' && (
        <div className="auxiliary-runtime" role="status" aria-live="polite">
          <h3>当前没有活跃辅助链</h3>
          <p className="ruling-result-desc">
            请回到协议启动页启动辅助链，或从全局提醒进入正在运行的辅助链窗口。
          </p>
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chain.id}`)}>
            返回协议启动页
          </button>
        </div>
      )}

      {phase === 'done' && (
        <AuxiliaryDone chain={chain} doneResult={doneResult} />
      )}

      {phase === 'ruling' && (
        <>
          <AuxiliaryRuling
            behaviorType={behaviorType}
            customBehavior={customBehavior}
            debugCategory={debugCategory}
            debugNote={debugNote}
            rulingError={rulingError}
            setBehaviorType={setBehaviorType}
            setCustomBehavior={setCustomBehavior}
            setDebugCategory={setDebugCategory}
            setDebugNote={setDebugNote}
            onResetRuling={handleResetRuling}
            onPrecedentRuling={handlePrecedentRuling}
          />
          <SessionDetails title="查看链详情">
            <ProtocolFact label="触发动作" value={chain.auxiliary_trigger_action} />
            <ProtocolFact label="完成条件" value={chain.auxiliary_completion_condition} />
            <ProtocolFact label="预约时间" value={`${chain.auxiliary_delay_minutes} 分钟`} />
            <ProtocolFact label="当前辅助链" value={`${chain.auxiliary_current_length} 节`} />
            <ProtocolFact label="最佳辅助链" value={`${chain.auxiliary_best_length} 节`} />
          </SessionDetails>
        </>
      )}

      {(phase === 'countdown' || phase === 'confirming') && reservation && (
        <>
          <div className="focus-timer">
            <span className="focus-time">{formatTime(remaining)}</span>
            <span className="focus-status">{phase === 'confirming' ? '确认窗口' : '预约窗口'}</span>
          </div>
          <div className="session-actions">
            <button className="btn btn-primary btn-large" onClick={enterMainFromReservation}>
              进入主链
            </button>
            <button className="btn btn-secondary" onClick={() => navigate(`/chains/${chain.id}`)}>
              返回启动页
            </button>
          </div>
          <p className="focus-hint session-hint">
            {phase === 'confirming'
              ? '确认窗口结束前进入主链仍视为履约成功。'
              : '预约窗口结束前进入主链即视为辅助链履约成功。'}
          </p>
          <SessionDetails title="查看链详情">
            <ProtocolFact label="触发动作" value={reservation.trigger_action} />
            <ProtocolFact label="完成条件" value={reservation.completion_condition} />
            <ProtocolFact label="预约时间" value={`${chain.auxiliary_delay_minutes} 分钟`} />
            <ProtocolFact
              label={phase === 'confirming' ? '确认截止' : '窗口结束'}
              value={formatDateTime(phase === 'confirming' ? reservation.confirmation_due_at ?? reservation.due_at : reservation.due_at)}
            />
            <ProtocolFact label="当前辅助链" value={`${chain.auxiliary_current_length} 节`} />
            <ProtocolFact label="最佳辅助链" value={`${chain.auxiliary_best_length} 节`} />
          </SessionDetails>
        </>
      )}
    </div>
  );
}

function sessionStateLabel(phase: Phase): string {
  if (phase === 'countdown') return '预约窗口';
  if (phase === 'confirming') return '等待确认';
  if (phase === 'ruling') return '辅助链裁决';
  if (phase === 'done') return '裁决完成';
  return '辅助链';
}

function SessionDetails({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="session-details">
      <summary>{title}</summary>
      <div className="session-detail-card">
        {children}
      </div>
    </details>
  );
}

function AuxiliaryDone({
  chain,
  doneResult,
}: {
  chain: Chain;
  doneResult: DoneResult | null;
}) {
  const precedent = doneResult?.kind === 'failed_precedent' ? doneResult.data.precedent : null;
  return (
    <div className="auxiliary-runtime" role="status" aria-live="polite">
      <h3>{precedent ? '辅助链判例化完成' : '辅助链裁决完成'}</h3>
      <p className="ruling-result-desc">
        {precedent
          ? `新的辅助链边界已写入：${precedent.title}。主链和辅助链长度保持不变。`
          : `辅助链已判定违约。主链 ${chain.name} 的长度不受影响，辅助链连续长度已清零。`}
      </p>
      <div className="focus-chain-update">
        <span className="focus-chain-label">{chain.name}</span>
        <div className="focus-chain-numbers">
          <span className="focus-chain-item">
            当前 <strong>{chain.current_length}</strong> 节
          </span>
          <span className="focus-chain-item">
            最佳 <strong>{chain.best_length}</strong> 节
          </span>
        </div>
        <div className="focus-chain-numbers">
          <span className="focus-chain-item">
            辅助当前 <strong>{chain.auxiliary_current_length}</strong> 节
          </span>
          <span className="focus-chain-item">
            辅助最佳 <strong>{chain.auxiliary_best_length}</strong> 节
          </span>
        </div>
      </div>
    </div>
  );
}

function AuxiliaryRuling({
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
}: {
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
}) {
  return (
    <div className="auxiliary-runtime ruling-panel-wide" role="region" aria-labelledby="auxiliary-ruling-heading">
      <h3 id="auxiliary-ruling-heading">辅助链裁决</h3>
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

      {rulingError && <p className="form-error" role="alert">{rulingError}</p>}

      <div className="ruling-options">
        <button className="ruling-option ruling-reset" onClick={onResetRuling} aria-label="判定辅助链违约并清零辅助链">
          <span className="ruling-option-title">判定违约：辅助链断裂并清零</span>
          <span className="ruling-option-consequence">主链长度不变；本次事件写入协议时间线。</span>
        </button>
        <button className="ruling-option ruling-precedent" onClick={onPrecedentRuling} aria-label="将本次辅助链事件写入判例">
          <span className="ruling-option-title">判例化：写入辅助链边界</span>
          <span className="ruling-option-consequence">辅助链不清零，未来同类情况默认允许。</span>
        </button>
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
