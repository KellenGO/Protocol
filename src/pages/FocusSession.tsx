import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getChain,
  getActiveFocusSession,
  completeFocusSession,
  failFocusSessionReset,
  failFocusSessionPrecedent,
} from '../lib/db';
import type {
  ActiveFocusSession,
  Chain,
  CompleteFocusResult,
  FailResetResult,
  FailPrecedentResult,
} from '../types';

type Phase =
  | 'loading'
  | 'running'
  | 'ruling'
  | 'ruling_precedent'
  | 'done'
  | 'empty';

type DoneResult =
  | { kind: 'completed'; data: CompleteFocusResult }
  | { kind: 'failed_reset'; data: FailResetResult }
  | { kind: 'failed_precedent'; data: FailPrecedentResult };

export default function FocusSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const chainId = Number(id);

  const [chain, setChain] = useState<Chain | null>(null);
  const [session, setSession] = useState<ActiveFocusSession | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);

  // Precedent form state
  const [precedentTitle, setPrecedentTitle] = useState('');
  const [precedentDesc, setPrecedentDesc] = useState('');
  const [precedentError, setPrecedentError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!chainId) return;

    async function init() {
      try {
        const c = await getChain(chainId);
        setChain(c);

        const active = await getActiveFocusSession(chainId);
        if (active && active.expected_end_at) {
          const end = new Date(active.expected_end_at + 'Z').getTime();
          const now = Date.now();
          const left = Math.max(0, Math.ceil((end - now) / 1000));
          setSession(active);
          setRemaining(left);
          setPhase('running');
        } else {
          setPhase('empty');
        }
      } catch (err) {
        setError(String(err));
      }
    }

    init();
  }, [chainId]);

  // Countdown
  useEffect(() => {
    if (phase !== 'running') return;

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

  useEffect(() => {
    if (remaining === 0 && phase === 'running' && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [remaining, phase]);

  async function handleComplete() {
    if (!session) return;
    try {
      const r = await completeFocusSession(session.id);
      setDoneResult({ kind: 'completed', data: r });
      setPhase('done');
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRulingReset() {
    if (!session) return;
    try {
      const r = await failFocusSessionReset(session.id);
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
    if (!session) return;
    try {
      const r = await failFocusSessionPrecedent(
        session.id,
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

  // ===== RENDER: error =====
  if (error) {
    return (
      <div className="page">
        <p className="placeholder-text">发生错误: {error}</p>
        <button className="btn btn-secondary" onClick={() => navigate(`/chains/${chainId}`)}>
          ← 返回链详情
        </button>
      </div>
    );
  }

  // ===== RENDER: loading =====
  if (phase === 'loading') {
    return (
      <div className="page">
        <p className="placeholder-text">正在准备任务…</p>
      </div>
    );
  }

  // ===== RENDER: empty =====
  if (phase === 'empty') {
    return (
      <div className="page">
        <div className="empty-state">
          <p className="empty-title">没有进行中的任务</p>
          <p className="empty-desc">
            当前链没有活跃的正式任务。请返回链详情页，点击"开始正式任务"来创建一个新的任务。
          </p>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chainId}`)}>
            ← 返回链详情
          </button>
        </div>
      </div>
    );
  }

  // ===== RENDER: done =====
  if (phase === 'done' && doneResult) {
    return <DoneView result={doneResult} chainId={chainId} navigate={navigate} />;
  }

  // ===== RENDER: ruling precedent form =====
  if (phase === 'ruling_precedent') {
    return (
      <div className="page">
        <div className="ruling-panel">
          <h3>判例化 — 写入规则</h3>
          <p className="ruling-desc">
            该行为将被正式写入本链判例库。写入后，未来同类情形在本链生命周期内视为永久允许，当前链长度不会清零。
          </p>

          <label className="form-field">
            <span>判例标题</span>
            <input
              type="text"
              value={precedentTitle}
              onChange={(e) => {
                setPrecedentTitle(e.target.value);
                setPrecedentError('');
              }}
              placeholder="例如：允许临时接听紧急电话"
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

  // ===== RENDER: ruling choice =====
  if (phase === 'ruling') {
    return (
      <div className="page">
        <div className="ruling-panel">
          <h3>任务裁决</h3>
          <p className="ruling-desc">
            你选择中途结束本次正式任务。请做出正式裁决：要么承认本次违背主链协议并清零，要么把该行为永久写入判例。
          </p>

          <div className="ruling-options">
            <button className="ruling-option ruling-reset" onClick={handleRulingReset}>
              <span className="ruling-option-title">判定违规</span>
              <span className="ruling-option-consequence">
                裁定本次破坏主链协议，当前主链立即清零，历史最佳长度保留
              </span>
            </button>

            <button className="ruling-option ruling-precedent" onClick={() => setPhase('ruling_precedent')}>
              <span className="ruling-option-title">判例化</span>
              <span className="ruling-option-consequence">
                保留链长度，该行为写入判例库，未来同类情形永久允许
              </span>
            </button>
          </div>

          <button
            className="btn btn-secondary"
            style={{ marginTop: 12 }}
            onClick={() => setPhase('running')}
          >
            取消，返回任务
          </button>
        </div>
      </div>
    );
  }

  // ===== RENDER: running =====
  const isTimerDone = remaining === 0;

  return (
    <div className="page">
      {chain && (
        <>
          <div className="focus-header">
            <h2>{chain.name}</h2>
            <span className="focus-chain-length">
              当前 {chain.current_length} 节 · 本次目标 {chain.focus_duration_minutes} 分钟
            </span>
          </div>

          <div className={`focus-timer ${isTimerDone ? 'timer-done' : ''}`}>
            <span className="focus-time">{formatTime(remaining)}</span>
            <span className="focus-status">
              {isTimerDone ? '时间到' : '进行中'}
            </span>
          </div>

          {isTimerDone ? (
            <button className="btn btn-primary btn-large" onClick={handleComplete}>
              确认完成任务
            </button>
          ) : (
            <button
              className="btn btn-danger-outline"
              onClick={() => setPhase('ruling')}
            >
              中途失败
            </button>
          )}

          <button
            className="btn btn-secondary"
            style={{ marginTop: 12 }}
            onClick={() => navigate(`/chains/${chainId}`)}
          >
            ← 返回链详情
          </button>
        </>
      )}
    </div>
  );
}

// ===== Done View Sub-component =====

function DoneView({
  result,
  chainId,
  navigate,
}: {
  result: DoneResult;
  chainId: number;
  navigate: (path: string) => void;
}) {
  if (result.kind === 'completed') {
    const { session: done, chain: updated } = result.data;
    return (
      <div className="page">
        <div className="focus-complete">
          <div className="focus-complete-icon">&#10003;</div>
          <h2>本次任务已完成</h2>

          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">专注时长</span>
              <span className="detail-value">{done.duration_minutes} 分钟</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">任务开始</span>
              <span className="detail-value" style={{ fontSize: 12 }}>
                {new Date(done.started_at + 'Z').toLocaleTimeString('zh-CN')}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">完成时间</span>
              <span className="detail-value" style={{ fontSize: 12 }}>
                {done.ended_at
                  ? new Date(done.ended_at + 'Z').toLocaleTimeString('zh-CN')
                  : '—'}
              </span>
            </div>
          </div>

          <div className="focus-chain-update">
            <span className="focus-chain-label">{updated.name}</span>
            <div className="focus-chain-numbers">
              <span className="focus-chain-item">
                当前 <strong>{updated.current_length}</strong> 节
              </span>
              <span className="focus-chain-item">
                最佳 <strong>{updated.best_length}</strong> 节
              </span>
            </div>
          </div>

          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chainId}`)}>
            ← 返回链详情
          </button>
        </div>
      </div>
    );
  }

  if (result.kind === 'failed_reset') {
    const { chain: updated } = result.data;
    return (
      <div className="page">
        <div className="focus-complete">
          <div className="focus-complete-icon focus-fail-icon">&#10007;</div>
          <h2>判定违规</h2>
          <p className="ruling-result-desc">
            本次行为已被裁定为破坏主链协议，当前主链已清零。
          </p>

          <div className="focus-chain-update">
            <span className="focus-chain-label">{updated.name}</span>
            <div className="focus-chain-numbers">
              <span className="focus-chain-item">
                当前 <strong>0</strong> 节
              </span>
              <span className="focus-chain-item">
                最佳 <strong>{updated.best_length}</strong> 节（保留）
              </span>
            </div>
          </div>

          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chainId}`)}>
            ← 返回链详情
          </button>
        </div>
      </div>
    );
  }

  if (result.kind === 'failed_precedent') {
    const { chain: updated, precedent } = result.data;
    return (
      <div className="page">
        <div className="focus-complete">
          <div className="focus-complete-icon focus-precedent-icon">&#9702;</div>
          <h2>已判例化</h2>
          <p className="ruling-result-desc">
            该行为已写入本链判例库，未来同类情形永久允许；当前主链未清零。
          </p>

          <div className="focus-chain-update">
            <span className="focus-chain-label">{updated.name}</span>
            <div className="focus-chain-numbers">
              <span className="focus-chain-item">
                当前 <strong>{updated.current_length}</strong> 节
              </span>
              <span className="focus-chain-item">
                最佳 <strong>{updated.best_length}</strong> 节
              </span>
            </div>
          </div>

          <div className="precedent-ref">
            <span className="precedent-ref-label">新增判例</span>
            <span className="precedent-ref-title">{precedent.title}</span>
          </div>

          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chainId}`)}>
            ← 返回链详情
          </button>
        </div>
      </div>
    );
  }

  return null;
}
