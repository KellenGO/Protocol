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
import { FAILURE_DEBUG_CATEGORIES } from '../features/ctdp/protocolOptions';
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
  const [debugCategory, setDebugCategory] = useState(FAILURE_DEBUG_CATEGORIES[0]);
  const [debugNote, setDebugNote] = useState('');
  const [rulingError, setRulingError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!chainId) return;
    let cancelled = false;

    async function init() {
      try {
        const [c, p, active] = await Promise.all([
          getChain(chainId),
          getChainPrecedents(chainId),
          getActiveFocusSession(chainId),
        ]);
        if (cancelled) return;

        setChain(c);
        setPrecedents(p);

        if (active && active.expected_end_at) {
          setSession(active);
          if (searchParams.get('mode') === 'ruling') {
            await setFocusSessionPendingRuling(active.id);
            if (!cancelled) setPhase('ruling');
            return;
          }

          const globalPending = await getGlobalActiveFocusSession();
          if (!cancelled && globalPending?.id === active.id && globalPending.pending_ruling) {
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
        if (!cancelled) setError(String(err));
      }
    }

    init();
    return () => {
      cancelled = true;
    };
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
      const result = await completeFocusSession(session.id);
      setDoneResult({ kind: 'completed', data: result });
      setPhase('done');
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRulingReset() {
    const behavior = getBehavior();
    if (!session || !behavior) return;
    try {
      const result = await failFocusSessionReset(
        session.id,
        behavior,
        debugCategory,
        debugNote,
      );
      setDoneResult({ kind: 'failed_reset', data: result });
      setPhase('done');
    } catch (err) {
      setRulingError(String(err));
    }
  }

  async function handleRulingPrecedent() {
    const behavior = getBehavior();
    if (!session || !behavior) return;
    try {
      const result = await failFocusSessionPrecedent(
        session.id,
        { title: behavior, description: '' },
        debugCategory,
        debugNote,
      );
      setDoneResult({ kind: 'failed_precedent', data: result });
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
        <p className="placeholder-text">正在准备神圣座位...</p>
      </div>
    );
  }

  if (phase === 'empty') {
    return (
      <div className="page">
        <div className="empty-state">
          <p className="empty-title">没有进行中的神圣座位</p>
          <p className="empty-desc">当前主链没有活跃任务。请回到链详情页启动主链或辅助链。</p>
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
            神圣座位已经被占用。现在要么判定违约并断链，要么把这类情况写成判例，成为未来协议边界的一部分。
          </p>

          <BehaviorTypeField
            behaviorType={behaviorType}
            customBehavior={customBehavior}
            setBehaviorType={setBehaviorType}
            setCustomBehavior={setCustomBehavior}
          />
          <DebugFields
            debugCategory={debugCategory}
            debugNote={debugNote}
            setDebugCategory={setDebugCategory}
            setDebugNote={setDebugNote}
          />
          <BoundaryList precedents={precedents} />

          {rulingError && <p className="form-error">{rulingError}</p>}
          <div className="ruling-options">
            <button className="ruling-option ruling-reset" onClick={handleRulingReset}>
              <span className="ruling-option-title">判定违约：主链断裂并清零</span>
              <span className="ruling-option-consequence">记录失败调试；本次事件写入协议时间线。</span>
            </button>

            <button className="ruling-option ruling-precedent" onClick={handleRulingPrecedent}>
              <span className="ruling-option-title">判例化：写入协议边界</span>
              <span className="ruling-option-consequence">当前链不清零，未来同类行为默认允许。</span>
            </button>
          </div>

          <button className="btn btn-secondary" onClick={returnToTask}>
            返回神圣座位
          </button>
        </div>
      </div>
    );
  }

  const isTimerDone = remaining === 0;

  return (
    <div className="page">
      {chain && session && (
        <>
          <div className="focus-header">
            <h2>{chain.name}</h2>
            <span className="focus-chain-length">
              神圣座位已占用 / 当前 {chain.current_length} 节 / 本次 {session.duration_minutes ?? chain.focus_duration_minutes} 分钟
            </span>
          </div>

          <div className="focus-protocol-snapshot">
            <ProtocolSnapshot label="触发动作" value={session.trigger_action} />
            <ProtocolSnapshot label="完成条件" value={session.completion_condition} />
          </div>

          <div className={`focus-timer ${isTimerDone ? 'timer-done' : ''}`}>
            <span className="focus-time">{formatTime(remaining)}</span>
            <span className="focus-status">{isTimerDone ? '时间已到' : '神圣座位进行中'}</span>
          </div>

          {isTimerDone ? (
            <button className="btn btn-primary btn-large" onClick={handleComplete}>
              确认主链完成
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

function ProtocolSnapshot({ label, value }: { label: string; value: string }) {
  return (
    <div className="protocol-fact">
      <span className="detail-label">{label}</span>
      <span className="protocol-fact-value">{value}</span>
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
          <input
            value={customBehavior}
            onChange={(e) => setCustomBehavior(e.target.value)}
            placeholder="简短描述争议行为"
          />
        </label>
      )}
    </div>
  );
}

function DebugFields({
  debugCategory,
  debugNote,
  setDebugCategory,
  setDebugNote,
}: {
  debugCategory: string;
  debugNote: string;
  setDebugCategory: (value: string) => void;
  setDebugNote: (value: string) => void;
}) {
  return (
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
          placeholder="可选：记录下次调整协议时要看的线索"
        />
      </label>
    </div>
  );
}

function BoundaryList({ precedents }: { precedents: ChainPrecedent[] }) {
  return (
    <div className="ruling-boundary">
      <h4>主链现有边界</h4>
      {precedents.length === 0 ? (
        <p className="precedents-empty">当前没有判例，协议边界仍保持严格。</p>
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
          <h2>主链完成</h2>
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
          <h2>主链裁决：判定违约</h2>
          <p className="ruling-result-desc">链条已断裂并清零；失败调试已记录到本次会话。</p>
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
          <p className="ruling-result-desc">新的协议边界已写入：{precedent.title}</p>
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
