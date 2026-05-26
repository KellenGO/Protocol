import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  clearReservationSessionPendingRuling,
  failReservationSessionReset,
  fulfillReservationAndStartFocus,
  getAppSettings,
  getChainReservationPrecedents,
  getChains,
  getGlobalActiveFocusSession,
  getGlobalActiveReservationSession,
  precedentReservationSessionFailure,
  setReservationSessionPendingRuling,
  startReservationSession,
} from '../lib/db';
import type {
  ActiveReservationSession,
  Chain,
  ChainPrecedent,
  FailReservationPrecedentResult,
  FailReservationResetResult,
} from '../types';

type Phase = 'loading' | 'idle' | 'countdown' | 'due' | 'ruling' | 'done';

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

function resolveBehavior(behaviorType: string, customBehavior: string): string {
  if (behaviorType === '其他') return customBehavior.trim();
  return behaviorType;
}

function BoundaryList({ precedents }: { precedents: ChainPrecedent[] }) {
  return (
    <div className="ruling-boundary">
      <h4>以下行为已经被写入协议边界，未来默认允许：</h4>
      {precedents.length === 0 ? (
        <p className="precedents-empty">当前没有判例，协议边界仍保持严格状态。</p>
      ) : (
        <div className="precedents-list">
          {precedents.map((p) => (
            <div key={p.id} className="precedent-item">
              <div className="precedent-item-header">
                <span className="precedent-item-title">{p.title}</span>
                <span className="precedent-item-time">{formatDateTime(p.created_at)}</span>
              </div>
              {p.description && <p className="precedent-item-desc">{p.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Reservation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [chains, setChains] = useState<Chain[]>([]);
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [delayMinutes, setDelayMinutes] = useState(15);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState('');
  const [reservation, setReservation] = useState<ActiveReservationSession | null>(null);
  const [chainForReservation, setChainForReservation] = useState<Chain | null>(null);
  const [reservationPrecedents, setReservationPrecedents] = useState<ChainPrecedent[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [behaviorType, setBehaviorType] = useState(behaviorTypes[0]);
  const [customBehavior, setCustomBehavior] = useState('');
  const [rulingError, setRulingError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    init();
  }, [searchParams]);

  async function init() {
    try {
      const settings = await getAppSettings();
      const defaultDelay = settings.find((s) => s.key === 'default_reservation_duration');
      if (defaultDelay) {
        const v = parseInt(defaultDelay.value, 10);
        if (v > 0) setDelayMinutes(v);
      }
      setSettingsLoaded(true);

      const list = await getChains();
      setChains(list);

      const globalActive = await getGlobalActiveReservationSession();
      if (globalActive) {
        setReservation(globalActive);
        const chain = list.find((c) => c.id === globalActive.chain_id) || null;
        setChainForReservation(chain);
        setSelectedChainId(globalActive.chain_id);
        setReservationPrecedents(await getChainReservationPrecedents(globalActive.chain_id));

        if (searchParams.get('mode') === 'ruling') {
          await setReservationSessionPendingRuling(globalActive.id);
          setPhase('ruling');
          return;
        }

        if (globalActive.pending_ruling) {
          setPhase('ruling');
          return;
        }

        const due = new Date(globalActive.due_at + 'Z').getTime();
        const left = Math.max(0, Math.ceil((due - Date.now()) / 1000));
        setRemaining(left);
        setPhase(left > 0 ? 'countdown' : 'due');
        return;
      }

      if (list.length > 0) setSelectedChainId(list[0].id);
      setPhase('idle');
    } catch (err) {
      setError(String(err));
    }
  }

  function resetToIdle() {
    setDoneResult(null);
    setReservation(null);
    setChainForReservation(null);
    setReservationPrecedents([]);
    setRemaining(0);
    setError('');
    setRecoveryMsg('');
    setCustomBehavior('');
    setRulingError('');
    setPhase('loading');
    navigate('/reservation', { replace: true });
    init();
  }

  useEffect(() => {
    if (phase !== 'countdown') return;

    timerRef.current = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  useEffect(() => {
    if (remaining === 0 && phase === 'countdown' && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setPhase('due');
    }
  }, [remaining, phase]);

  function getBehavior(): string | null {
    const behavior = resolveBehavior(behaviorType, customBehavior);
    if (!behavior) {
      setRulingError('请填写自定义争议行为。');
      return null;
    }
    setRulingError('');
    return behavior;
  }

  async function enterRuling() {
    if (!reservation) return;
    try {
      await setReservationSessionPendingRuling(reservation.id);
      setPhase('ruling');
      navigate('/reservation?mode=ruling', { replace: true });
    } catch (err) {
      setError(String(err));
    }
  }

  async function returnToDue() {
    if (reservation) await clearReservationSessionPendingRuling(reservation.id).catch(console.error);
    setPhase('due');
    navigate('/reservation', { replace: true });
  }

  async function handleCreate() {
    if (!selectedChainId) {
      setError('请选择目标主链。');
      return;
    }
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1) {
      setError('预约延迟必须为正整数。');
      return;
    }
    setError('');
    setRecoveryMsg('');
    setCreating(true);
    try {
      const globalReservation = await getGlobalActiveReservationSession();
      if (globalReservation) {
        setRecoveryMsg(`已有进行中的预约：${globalReservation.chain_name}，已恢复该协议流程。`);
        const chain = chains.find((c) => c.id === globalReservation.chain_id) || null;
        setReservation(globalReservation);
        setChainForReservation(chain);
        setSelectedChainId(globalReservation.chain_id);
        setReservationPrecedents(await getChainReservationPrecedents(globalReservation.chain_id));
        const due = new Date(globalReservation.due_at + 'Z').getTime();
        const left = Math.max(0, Math.ceil((due - Date.now()) / 1000));
        setRemaining(left);
        setPhase(globalReservation.pending_ruling ? 'ruling' : left > 0 ? 'countdown' : 'due');
        return;
      }

      const globalFocus = await getGlobalActiveFocusSession();
      if (globalFocus) {
        setError(`当前已有进行中的正式任务：${globalFocus.chain_name}。请先完成或裁决该任务。`);
        return;
      }

      const r = await startReservationSession(selectedChainId, delayMinutes);
      const chain = chains.find((c) => c.id === selectedChainId) || null;
      setReservation(r);
      setChainForReservation(chain);
      setReservationPrecedents(await getChainReservationPrecedents(selectedChainId));
      setRemaining(delayMinutes * 60);
      setPhase('countdown');
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleFulfill() {
    if (!reservation) return;
    try {
      const r = await fulfillReservationAndStartFocus(reservation.id);
      navigate(`/chains/${r.chain_id}/focus`);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRulingReset() {
    const behavior = getBehavior();
    if (!reservation || !behavior) return;
    try {
      const r = await failReservationSessionReset(reservation.id, behavior);
      setDoneResult({ kind: 'failed_reset', data: r });
      setPhase('done');
    } catch (err) {
      setRulingError(String(err));
    }
  }

  async function handleRulingPrecedent() {
    const behavior = getBehavior();
    if (!reservation || !behavior) return;
    try {
      const r = await precedentReservationSessionFailure(reservation.id, {
        title: behavior,
        description: '',
      });
      setDoneResult({ kind: 'failed_precedent', data: r });
      setPhase('done');
    } catch (err) {
      setRulingError(String(err));
    }
  }

  if (phase === 'loading') {
    return (
      <div className="page">
        <h2>预约启动</h2>
        <p className="placeholder-text">加载中...</p>
      </div>
    );
  }

  if (phase === 'done' && doneResult) {
    if (doneResult.kind === 'failed_reset') {
      const { chain } = doneResult.data;
      return (
        <div className="page">
          <div className="focus-complete">
            <div className="focus-complete-icon focus-fail-icon">&#10007;</div>
            <h2>预约违约裁决</h2>
            <p className="ruling-result-desc">预约失败记录成立；主链 {chain.name} 的长度不受影响。</p>
            <ChainUpdate chain={chain} />
            <button className="btn btn-primary" onClick={resetToIdle}>返回预约页</button>
          </div>
        </div>
      );
    }

    const { chain, precedent } = doneResult.data;
    return (
      <div className="page">
        <div className="focus-complete">
          <div className="focus-complete-icon focus-precedent-icon">&#9702;</div>
          <h2>预约判例化</h2>
          <p className="ruling-result-desc">允许“{precedent.title}”，未来同类情况默认允许；主链 {chain.name} 的长度不受影响。</p>
          <ChainUpdate chain={chain} />
          <div className="precedent-ref">
            <span className="precedent-ref-label">新增预约边界</span>
            <span className="precedent-ref-title">{precedent.title}</span>
          </div>
          <button className="btn btn-primary" onClick={resetToIdle}>返回预约页</button>
        </div>
      </div>
    );
  }

  if (phase === 'ruling') {
    return (
      <div className="page">
        <div className="ruling-panel ruling-panel-wide">
          <h3>预约违约裁决</h3>
          <p className="ruling-desc">
            你正在裁决一次预约未履约事件。判定违约会记录预约失败；判例化则意味着该类情形将成为未来允许的先例。
          </p>

          <BehaviorTypeField
            behaviorType={behaviorType}
            customBehavior={customBehavior}
            setBehaviorType={setBehaviorType}
            setCustomBehavior={setCustomBehavior}
          />

          <BoundaryList precedents={reservationPrecedents} />

          {rulingError && <p className="form-error">{rulingError}</p>}
          <div className="ruling-options">
            <button className="ruling-option ruling-reset" onClick={handleRulingReset}>
              <span className="ruling-option-title">判定预约违约：预约失败记录成立</span>
              <span className="ruling-option-consequence">本次事件写入协议时间线。</span>
            </button>
            <button className="ruling-option ruling-precedent" onClick={handleRulingPrecedent}>
              <span className="ruling-option-title">预约判例化：写入协议边界</span>
              <span className="ruling-option-consequence">未来同类情形默认允许。</span>
            </button>
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={returnToDue}>返回预约</button>
        </div>
      </div>
    );
  }

  if (phase === 'due' && reservation && chainForReservation) {
    return (
      <div className="page">
        <h2>预约启动</h2>
        <div className="reservation-session">
          <div className="res-session-header">
            <span className="res-chain-name">{chainForReservation.name}</span>
            <span className="res-due-label">到期时间 {formatDateTime(reservation.due_at)}</span>
          </div>
          <div className="focus-timer timer-done">
            <span className="focus-time">00:00</span>
            <span className="focus-status">预约已到期</span>
          </div>
          <div className="res-actions">
            <button className="btn btn-primary btn-large" onClick={handleFulfill}>立即履约并进入正式任务</button>
            <button className="btn btn-danger-outline" style={{ marginTop: 10 }} onClick={enterRuling}>
              未履约，进入预约违约裁决
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'countdown' && reservation && chainForReservation) {
    return (
      <div className="page">
        <h2>预约启动</h2>
        <div className="reservation-session">
          <div className="res-session-header">
            <span className="res-chain-name">{chainForReservation.name}</span>
            <span className="res-due-label">到期时间 {formatDateTime(reservation.due_at)}</span>
          </div>
          <div className="focus-timer">
            <span className="focus-time">{formatTime(remaining)}</span>
            <span className="focus-status">预约进行中</span>
          </div>
          <p className="focus-hint" style={{ textAlign: 'center' }}>
            预约到期后，可以履约进入正式任务，或对未履约事件进行裁决。
          </p>
          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={resetToIdle}>
            刷新状态
          </button>
        </div>
      </div>
    );
  }

  const selectedChain = chains.find((c) => c.id === selectedChainId);

  return (
    <div className="page">
      <h2>预约启动</h2>
      {recoveryMsg && <p className="recovery-msg" style={{ marginBottom: 16 }}>{recoveryMsg}</p>}
      {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}

      {!settingsLoaded ? (
        <p className="placeholder-text">加载中...</p>
      ) : chains.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">没有可用主链</p>
          <p className="empty-desc">请先创建至少一条主链，再进行预约启动。</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/chains')}>去创建主链</button>
        </div>
      ) : (
        <div className="reservation-form">
          <label className="form-field">
            <span>目标主链</span>
            <select className="form-select" value={selectedChainId ?? ''} onChange={(e) => setSelectedChainId(Number(e.target.value))}>
              {chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（当前 {c.current_length} 节 / {c.focus_duration_minutes}min）
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>预约延迟（分钟）</span>
            <input type="number" value={delayMinutes} onChange={(e) => setDelayMinutes(Number(e.target.value))} min={1} />
          </label>

          <button className="btn btn-primary" disabled={creating} onClick={handleCreate}>
            {creating ? '创建中...' : '开始预约'}
          </button>

          {selectedChain && (
            <p className="res-chain-info">
              目标链：{selectedChain.name} / 默认专注 {selectedChain.focus_duration_minutes} 分钟 / 当前 {selectedChain.current_length} 节
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BehaviorTypeField({
  behaviorType,
  customBehavior,
  setBehaviorType,
  setCustomBehavior,
}: {
  behaviorType: string;
  customBehavior: string;
  setBehaviorType: (value: string) => void;
  setCustomBehavior: (value: string) => void;
}) {
  return (
    <div className="ruling-form">
      <label className="form-field">
        <span>争议行为类型</span>
        <select className="form-select" value={behaviorType} onChange={(e) => setBehaviorType(e.target.value)}>
          {behaviorTypes.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>

      {behaviorType === '其他' && (
        <label className="form-field">
          <span>自定义争议行为</span>
          <input value={customBehavior} onChange={(e) => setCustomBehavior(e.target.value)} placeholder="简短描述争议行为" />
        </label>
      )}
    </div>
  );
}

function ChainUpdate({ chain }: { chain: Chain }) {
  return (
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
    </div>
  );
}
