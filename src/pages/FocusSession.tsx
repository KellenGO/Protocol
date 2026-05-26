import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  clearFocusSessionPendingRuling,
  completeFocusSession,
  failFocusSessionPrecedent,
  failFocusSessionReset,
  getActiveFocusSession,
  getChain,
  getChainPrecedents,
  getGlobalActiveFocusSession,
  setFocusSessionPendingRuling,
} from '../lib/db';
import type {
  ActiveFocusSession,
  Chain,
  ChainPrecedent,
  CompleteFocusResult,
  FailPrecedentResult,
  FailResetResult,
} from '../types';

type Phase = 'loading' | 'running' | 'ruling' | 'done' | 'empty';

type DoneResult =
  | { kind: 'completed'; data: CompleteFocusResult }
  | { kind: 'failed_reset'; data: FailResetResult }
  | { kind: 'failed_precedent'; data: FailPrecedentResult };

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

function formatDate(raw: string): string {
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
                <span className="precedent-item-time">{formatDate(p.created_at)}</span>
              </div>
              {p.description && <p className="precedent-item-desc">{p.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FocusSessionPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chainId = Number(id);

  const [chain, setChain] = useState<Chain | null>(null);
  const [session, setSession] = useState<ActiveFocusSession | null>(null);
  const [precedents, setPrecedents] = useState<ChainPrecedent[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null);
  const [behaviorType, setBehaviorType] = useState(behaviorTypes[0]);
  const [customBehavior, setCustomBehavior] = useState('');
  const [rulingError, setRulingError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!chainId) return;

    async function init() {
      try {
        const [c, p, active] = await Promise.all([
          getChain(chainId),
          getChainPrecedents(chainId),
          getActiveFocusSession(chainId),
        ]);
        setChain(c);
        setPrecedents(p);

        if (active && active.expected_end_at) {
          setSession(active);
          if (searchParams.get('mode') === 'ruling') {
            await setFocusSessionPendingRuling(active.id);
            setPhase('ruling');
            return;
          }

          const globalPending = await getGlobalActiveFocusSession();
          if (globalPending?.id === active.id && globalPending.pending_ruling) {
            setPhase('ruling');
            return;
          }

          const end = new Date(active.expected_end_at + 'Z').getTime();
          setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
          setPhase('running');
        } else {
          setPhase('empty');
        }
      } catch (err) {
        setError(String(err));
      }
    }

    init();
  }, [chainId, searchParams]);

  useEffect(() => {
    if (phase !== 'running') return;

    timerRef.current = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
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
    if (!session) return;
    try {
      await setFocusSessionPendingRuling(session.id);
      setPhase('ruling');
      navigate(`/chains/${chainId}/focus?mode=ruling`, { replace: true });
    } catch (err) {
      setError(String(err));
    }
  }

  async function returnToTask() {
    if (session) await clearFocusSessionPendingRuling(session.id).catch(console.error);
    const end = session?.expected_end_at ? new Date(session.expected_end_at + 'Z').getTime() : Date.now();
    setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    setPhase('running');
    navigate(`/chains/${chainId}/focus`, { replace: true });
  }

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
    const behavior = getBehavior();
    if (!session || !behavior) return;
    try {
      const r = await failFocusSessionReset(session.id, behavior);
      setDoneResult({ kind: 'failed_reset', data: r });
      setPhase('done');
    } catch (err) {
      setRulingError(String(err));
    }
  }

  async function handleRulingPrecedent() {
    const behavior = getBehavior();
    if (!session || !behavior) return;
    try {
      const r = await failFocusSessionPrecedent(session.id, {
        title: behavior,
        description: '',
      });
      setDoneResult({ kind: 'failed_precedent', data: r });
      setPhase('done');
    } catch (err) {
      setRulingError(String(err));
    }
  }

  if (error) {
    return (
      <div className="page">
        <p className="placeholder-text">发生错误：{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate(`/chains/${chainId}`)}>
          返回链详情
        </button>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="page">
        <p className="placeholder-text">正在准备正式任务...</p>
      </div>
    );
  }

  if (phase === 'empty') {
    return (
      <div className="page">
        <div className="empty-state">
          <p className="empty-title">没有进行中的正式任务</p>
          <p className="empty-desc">当前主链没有活跃任务。请回到链详情页启动新的协议流程。</p>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chainId}`)}>
            返回链详情
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'done' && doneResult) {
    return <DoneView result={doneResult} chainId={chainId} navigate={navigate} />;
  }

  if (phase === 'ruling') {
    return (
      <div className="page">
        <div className="ruling-panel ruling-panel-wide">
          <h3>主链裁决</h3>
          <p className="ruling-desc">
            你正在做出一次协议裁决。判定违规会导致当前主链断裂并清零；判例化则意味着该行为将成为未来永久允许的先例。
          </p>

          <BehaviorTypeField
            behaviorType={behaviorType}
            customBehavior={customBehavior}
            setBehaviorType={setBehaviorType}
            setCustomBehavior={setCustomBehavior}
          />

          <BoundaryList precedents={precedents} />

          {rulingError && <p className="form-error">{rulingError}</p>}
          <div className="ruling-options">
            <button className="ruling-option ruling-reset" onClick={handleRulingReset}>
              <span className="ruling-option-title">判定违规：主链断裂并清零</span>
              <span className="ruling-option-consequence">本次事件写入协议时间线。</span>
            </button>

            <button className="ruling-option ruling-precedent" onClick={handleRulingPrecedent}>
              <span className="ruling-option-title">判例化：写入协议边界</span>
              <span className="ruling-option-consequence">当前链不清零，未来同类行为默认允许。</span>
            </button>
          </div>

          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={returnToTask}>
            返回任务
          </button>
        </div>
      </div>
    );
  }

  const isTimerDone = remaining === 0;

  return (
    <div className="page">
      {chain && (
        <>
          <div className="focus-header">
            <h2>{chain.name}</h2>
            <span className="focus-chain-length">
              当前 {chain.current_length} 节 / 本次 {chain.focus_duration_minutes} 分钟
            </span>
          </div>

          <div className={`focus-timer ${isTimerDone ? 'timer-done' : ''}`}>
            <span className="focus-time">{formatTime(remaining)}</span>
            <span className="focus-status">{isTimerDone ? '时间已到' : '协议进行中'}</span>
          </div>

          {isTimerDone ? (
            <button className="btn btn-primary btn-large" onClick={handleComplete}>
              确认正式任务完成
            </button>
          ) : (
            <button className="btn btn-danger-outline" onClick={enterRuling}>
              进入裁决
            </button>
          )}

          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => navigate(`/chains/${chainId}`)}>
            返回链详情
          </button>
        </>
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
            <option key={item} value={item}>
              {item}
            </option>
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
          <h2>正式任务完成</h2>
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">专注时长</span>
              <span className="detail-value">{done.duration_minutes} 分钟</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">任务开始</span>
              <span className="detail-value" style={{ fontSize: 12 }}>{formatDate(done.started_at)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">完成时间</span>
              <span className="detail-value" style={{ fontSize: 12 }}>{done.ended_at ? formatDate(done.ended_at) : '-'}</span>
            </div>
          </div>
          <ChainUpdate chain={updated} />
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chainId}`)}>返回链详情</button>
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
          <h2>主链裁决：判定违规</h2>
          <p className="ruling-result-desc">链条已断裂并清零；本次裁决已写入协议时间线。</p>
          <ChainUpdate chain={updated} forceCurrent={0} />
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chainId}`)}>返回链详情</button>
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
          <h2>主链判例化</h2>
          <p className="ruling-result-desc">允许“{precedent.title}”，未来同类行为默认允许；当前主链未清零。</p>
          <ChainUpdate chain={updated} />
          <div className="precedent-ref">
            <span className="precedent-ref-label">新增协议边界</span>
            <span className="precedent-ref-title">{precedent.title}</span>
          </div>
          <button className="btn btn-primary" onClick={() => navigate(`/chains/${chainId}`)}>返回链详情</button>
        </div>
      </div>
    );
  }

  return null;
}

function ChainUpdate({ chain, forceCurrent }: { chain: Chain; forceCurrent?: number }) {
  return (
    <div className="focus-chain-update">
      <span className="focus-chain-label">{chain.name}</span>
      <div className="focus-chain-numbers">
        <span className="focus-chain-item">
          当前 <strong>{forceCurrent ?? chain.current_length}</strong> 节
        </span>
        <span className="focus-chain-item">
          最佳 <strong>{chain.best_length}</strong> 节
        </span>
      </div>
    </div>
  );
}
