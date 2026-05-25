import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getChains,
  startReservationSession,
  getGlobalActiveReservationSession,
  getGlobalActiveFocusSession,
  fulfillReservationAndStartFocus,
  failReservationSessionReset,
  precedentReservationSessionFailure,
  getAppSettings,
} from '../lib/db';
import type {
  ActiveReservationSession,
  Chain,
  FailReservationResetResult,
  FailReservationPrecedentResult,
} from '../types';

type Phase =
  | 'loading'
  | 'idle'
  | 'countdown'
  | 'due'
  | 'ruling'
  | 'ruling_precedent'
  | 'done';

type DoneResult =
  | { kind: 'failed_reset'; data: FailReservationResetResult }
  | { kind: 'failed_precedent'; data: FailReservationPrecedentResult };

export default function Reservation() {
  const navigate = useNavigate();

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
  const [remaining, setRemaining] = useState(0);

  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);

  const [precedentTitle, setPrecedentTitle] = useState('');
  const [precedentDesc, setPrecedentDesc] = useState('');
  const [precedentError, setPrecedentError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load chains + settings + single global query for active reservation (recovery)
  useEffect(() => {
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
          const due = new Date(globalActive.due_at + 'Z').getTime();
          const now = Date.now();
          const left = Math.max(0, Math.ceil((due - now) / 1000));
          setRemaining(left);
          setPhase(left > 0 ? 'countdown' : 'due');
          return;
        }

        // No active reservation
        if (list.length > 0) {
          setSelectedChainId(list[0].id);
        }
        setPhase('idle');
      } catch (err) {
        setError(String(err));
      }
    }
    init();
  }, []);

  function resetToIdle() {
    setDoneResult(null);
    setReservation(null);
    setChainForReservation(null);
    setRemaining(0);
    setError('');
    setRecoveryMsg('');
    setPrecedentTitle('');
    setPrecedentDesc('');
    setPrecedentError('');
    setPhase('loading');
    // Re-trigger init
    (async () => {
      try {
        const list = await getChains();
        setChains(list);
        const globalActive = await getGlobalActiveReservationSession();
        if (globalActive) {
          setReservation(globalActive);
          const chain = list.find((c) => c.id === globalActive.chain_id) || null;
          setChainForReservation(chain);
          setSelectedChainId(globalActive.chain_id);
          const due = new Date(globalActive.due_at + 'Z').getTime();
          const now = Date.now();
          const left = Math.max(0, Math.ceil((due - now) / 1000));
          setRemaining(left);
          setPhase(left > 0 ? 'countdown' : 'due');
          return;
        }
        if (list.length > 0) setSelectedChainId(list[0].id);
        setPhase('idle');
      } catch (err) {
        setError(String(err));
      }
    })();
  }

  // Countdown
  useEffect(() => {
    if (phase !== 'countdown') return;

    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  // Transition to 'due' when timer hits 0
  useEffect(() => {
    if (remaining === 0 && phase === 'countdown' && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setPhase('due');
    }
  }, [remaining, phase]);

  async function handleCreate() {
    if (!selectedChainId) {
      setError('请选择目标链');
      return;
    }
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1) {
      setError('预约时长必须为正整数');
      return;
    }
    setError('');
    setRecoveryMsg('');
    setCreating(true);
    try {
      const globalReservation = await getGlobalActiveReservationSession();
      if (globalReservation) {
        setRecoveryMsg(
          `已有进行中的预约（链「${globalReservation.chain_name}」），已为你恢复。`,
        );
        setReservation(globalReservation);
        const chain = chains.find((c) => c.id === globalReservation.chain_id) || null;
        setChainForReservation(chain);
        setSelectedChainId(globalReservation.chain_id);
        const due = new Date(globalReservation.due_at + 'Z').getTime();
        const now = Date.now();
        const left = Math.max(0, Math.ceil((due - now) / 1000));
        setRemaining(left);
        setPhase(left > 0 ? 'countdown' : 'due');
        return;
      }

      const globalFocus = await getGlobalActiveFocusSession();
      if (globalFocus) {
        setError(
          `当前已有进行中的正式任务（链「${globalFocus.chain_name}」），请先完成或结束该任务。`,
        );
        return;
      }

      const r = await startReservationSession(selectedChainId, delayMinutes);
      const chain = chains.find((c) => c.id === selectedChainId) || null;
      setReservation(r);
      setChainForReservation(chain);
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
    if (!reservation) return;
    try {
      const r = await failReservationSessionReset(reservation.id);
      setDoneResult({ kind: 'failed_reset', data: r });
      setPhase('done');
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRulingPrecedent() {
    if (!precedentTitle.trim()) {
      setPrecedentError('判例标题不能为空');
      return;
    }
    if (!reservation) return;
    try {
      const r = await precedentReservationSessionFailure(
        reservation.id,
        precedentTitle.trim(),
        precedentDesc.trim(),
      );
      setDoneResult({ kind: 'failed_precedent', data: r });
      setPhase('done');
    } catch (err) {
      setPrecedentError(String(err));
    }
  }

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatDateTime(raw: string): string {
    return new Date(raw + 'Z').toLocaleString('zh-CN');
  }

  // ===== LOADING =====
  if (phase === 'loading') {
    return (
      <div className="page">
        <h2>预约启动</h2>
        <p className="placeholder-text">加载中…</p>
      </div>
    );
  }

  // ===== DONE =====
  if (phase === 'done' && doneResult) {
    if (doneResult.kind === 'failed_reset') {
      const { chain } = doneResult.data;
      return (
        <div className="page">
          <div className="focus-complete">
            <div className="focus-complete-icon focus-fail-icon">&#10007;</div>
            <h2>预约失败</h2>
            <p className="ruling-result-desc">
              本次预约被判定为未履约。主链 {chain.name} 的长度不受影响。
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
            </div>

            <button className="btn btn-primary" onClick={resetToIdle}>
              返回预约页
            </button>
          </div>
        </div>
      );
    }

    if (doneResult.kind === 'failed_precedent') {
      const { chain, precedent: p } = doneResult.data;
      return (
        <div className="page">
          <div className="focus-complete">
            <div className="focus-complete-icon focus-precedent-icon">&#9702;</div>
            <h2>已判例化</h2>
            <p className="ruling-result-desc">
              该预约行为已写入预约判例库。主链 {chain.name} 的长度不受影响。
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
            </div>

            <div className="precedent-ref">
              <span className="precedent-ref-label">新增预约判例</span>
              <span className="precedent-ref-title">{p.title}</span>
            </div>

            <button className="btn btn-primary" onClick={resetToIdle}>
              返回预约页
            </button>
          </div>
        </div>
      );
    }
  }

  // ===== RULING PRECEDENT FORM =====
  if (phase === 'ruling_precedent') {
    return (
      <div className="page">
        <h2>预约裁决</h2>
        <div className="ruling-panel" style={{ marginTop: 16 }}>
          <h3>判例化 — 写入规则</h3>
          <p className="ruling-desc">
            该预约情形将被正式写入预约判例库。写入后，未来同类预约情形视为永久允许，主链长度不会受影响。
          </p>

          <label className="form-field">
            <span>判例标题</span>
            <input
              type="text"
              value={precedentTitle}
              onChange={(e) => { setPrecedentTitle(e.target.value); setPrecedentError(''); }}
              placeholder="例如：预约期间因紧急会议未能履约"
              autoFocus
            />
          </label>
          <label className="form-field">
            <span>描述（可选）</span>
            <input
              type="text"
              value={precedentDesc}
              onChange={(e) => setPrecedentDesc(e.target.value)}
              placeholder="补充说明此判例的适用条件"
            />
          </label>
          {precedentError && <p className="form-error">{precedentError}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleRulingPrecedent}>
              确认判例化
            </button>
            <button className="btn btn-secondary" onClick={() => setPhase('ruling')}>
              返回裁决
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== RULING CHOICE =====
  if (phase === 'ruling') {
    return (
      <div className="page">
        <h2>预约裁决</h2>
        <div className="ruling-panel" style={{ marginTop: 16 }}>
          <h3>预约裁决</h3>
          <p className="ruling-desc">
            预约已到期但你未履约。请做出正式裁决：要么承认预约失败记录成立，要么把该情形永久写入预约判例。
          </p>
          <div className="ruling-options">
            <button className="ruling-option ruling-reset" onClick={handleRulingReset}>
              <span className="ruling-option-title">判定预约失败</span>
              <span className="ruling-option-consequence">
                本次预约记为未履约，预约失败记录成立。主链长度不受影响。
              </span>
            </button>
            <button className="ruling-option ruling-precedent" onClick={() => setPhase('ruling_precedent')}>
              <span className="ruling-option-title">判例化</span>
              <span className="ruling-option-consequence">
                保留预约记录，该情形写入预约判例库，未来同类情形永久允许。
              </span>
            </button>
          </div>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 12 }}
            onClick={() => setPhase('due')}
          >
            取消，返回预约
          </button>
        </div>
      </div>
    );
  }

  // ===== DUE =====
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
            <button className="btn btn-primary btn-large" onClick={handleFulfill}>
              立即开始正式任务
            </button>
            <button
              className="btn btn-danger-outline"
              style={{ marginTop: 10 }}
              onClick={() => setPhase('ruling')}
            >
              未履约，进入裁决
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== COUNTDOWN =====
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
            预约到期后，你可以选择立即进入正式任务，或对未履约行为进行裁决。
          </p>

          <button
            className="btn btn-secondary"
            style={{ marginTop: 12 }}
            onClick={async () => {
              try {
                const active = await getGlobalActiveReservationSession();
                if (active) {
                  const due = new Date(active.due_at + 'Z').getTime();
                  const now = Date.now();
                  const left = Math.max(0, Math.ceil((due - now) / 1000));
                  setRemaining(left);
                  if (left <= 0) setPhase('due');
                } else {
                  resetToIdle();
                }
              } catch (err) {
                setError(String(err));
              }
            }}
          >
            刷新状态
          </button>
        </div>
      </div>
    );
  }

  // ===== IDLE (no active reservation) =====
  const selectedChain = chains.find((c) => c.id === selectedChainId);

  return (
    <div className="page">
      <h2>预约启动</h2>

      {recoveryMsg && <p className="recovery-msg" style={{ marginBottom: 16 }}>{recoveryMsg}</p>}
      {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}

      {!settingsLoaded ? (
        <p className="placeholder-text">加载中…</p>
      ) : chains.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">没有可用主链</p>
          <p className="empty-desc">
            请先创建至少一条主链，再进行预约启动。
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => navigate('/chains')}
          >
            去创建主链
          </button>
        </div>
      ) : (
        <div className="reservation-form">
          <label className="form-field">
            <span>目标主链</span>
            <select
              className="form-select"
              value={selectedChainId ?? ''}
              onChange={(e) => setSelectedChainId(Number(e.target.value))}
            >
              {chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（当前 {c.current_length} 节 · {c.focus_duration_minutes}min）
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>预约延迟（分钟）</span>
            <input
              type="number"
              value={delayMinutes}
              onChange={(e) => setDelayMinutes(Number(e.target.value))}
              min={1}
            />
          </label>

          <button
            className="btn btn-primary"
            disabled={creating}
            onClick={handleCreate}
          >
            {creating ? '创建中…' : '开始预约'}
          </button>

          {selectedChain && (
            <p className="res-chain-info">
              目标链「{selectedChain.name}」· 默认专注 {selectedChain.focus_duration_minutes} 分钟 · 当前 {selectedChain.current_length} 节
            </p>
          )}
        </div>
      )}
    </div>
  );
}
