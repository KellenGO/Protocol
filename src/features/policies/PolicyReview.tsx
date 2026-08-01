import { useEffect, useMemo, useState } from 'react';
import { getPolicyCycles, getPolicyEvents, getPolicyLibrary } from '../../lib/db/policies';
import type { PolicyCycle, PolicyEvent, PolicyWithTreeStatus } from '../../types';

const DAY_MS = 86_400_000;
const RELIT_WINDOW_DAYS = 7;

interface PolicyDetail {
  policy: PolicyWithTreeStatus;
  cycles: PolicyCycle[];
  events: PolicyEvent[];
}

interface EventMetadata {
  old_name?: string | null;
  new_name?: string | null;
  old_parent_name?: string | null;
  new_parent_name?: string | null;
}

/** 后端以 UTC 存储 datetime('now')，与 protocolEvents.ts 保持一致：补 Z 按 UTC 解析 */
function parseUtcDate(raw: string): Date {
  return new Date(raw + 'Z');
}

function formatMonthDay(raw: string): string {
  const date = parseUtcDate(raw);
  const base = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (date.getFullYear() !== new Date().getFullYear()) {
    return `${date.getFullYear()}年${base}`;
  }
  return base;
}

/** 周期持续天数：把起始日算作第 1 天 */
function cycleDays(cycle: PolicyCycle): number {
  const start = parseUtcDate(cycle.started_at).getTime();
  const end = cycle.ended_at ? parseUtcDate(cycle.ended_at).getTime() : Date.now();
  return Math.max(1, Math.floor((end - start) / DAY_MS) + 1);
}

function parseMetadata(raw: string): EventMetadata | null {
  try {
    const parsed = JSON.parse(raw) as EventMetadata;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * lit 事件是否为"重新点亮"：向后（更早）查找最近的状态翻转事件，
 * 若是 extinguished 则为重新点亮（中间的重命名/调整等事件不影响判断）。
 */
function isRelit(events: PolicyEvent[], index: number): boolean {
  for (let i = index + 1; i < events.length; i++) {
    const type = events[i].event_type;
    if (type === 'lit' || type === 'extinguished') {
      return type === 'extinguished';
    }
  }
  return false;
}

const EVENT_LABELS: Record<PolicyEvent['event_type'], string> = {
  added_to_tree: '加入国策树',
  removed_from_tree: '从国策树移除',
  lit: '点亮',
  extinguished: '熄灭',
  reparented: '调整父节点',
  reordered: '调整同级顺序',
  renamed: '重命名',
};

/** 事件 → 中文文案（events 按新→旧排序） */
function eventLabel(events: PolicyEvent[], index: number): string {
  const event = events[index];
  switch (event.event_type) {
    case 'lit':
      return isRelit(events, index) ? '重新点亮' : '点亮';
    case 'renamed': {
      const meta = parseMetadata(event.metadata);
      if (meta?.old_name && meta?.new_name) {
        return `重命名：${meta.old_name} → ${meta.new_name}`;
      }
      return '重命名';
    }
    case 'reparented': {
      const meta = parseMetadata(event.metadata);
      const oldName = meta?.old_parent_name ?? null;
      const newName = meta?.new_parent_name ?? null;
      if (oldName && newName) return `调整父节点：从「${oldName}」移动到「${newName}」下`;
      if (oldName) return `调整父节点：从「${oldName}」下提升为根节点`;
      if (newName) return `调整父节点：从根节点移动到「${newName}」下`;
      return '调整父节点';
    }
    default:
      return EVENT_LABELS[event.event_type];
  }
}

function statusOf(policy: PolicyWithTreeStatus): { text: string; cls: 'lit' | 'extinguished' | 'out' } {
  if (policy.tree_status === 'lit') return { text: '点亮', cls: 'lit' };
  if (policy.tree_status === 'extinguished') return { text: '熄灭', cls: 'extinguished' };
  return { text: '不在树中', cls: 'out' };
}

/** 摘要快照：当前点亮 / 最近 7 天熄灭 / 最近 7 天重新点亮 */
function computeSummary(
  policies: PolicyWithTreeStatus[],
  details: Record<number, PolicyDetail>,
): { currentLit: number; extinguished7d: number; relit7d: number } {
  const now = Date.now();
  const windowMs = RELIT_WINDOW_DAYS * DAY_MS;
  let extinguished7d = 0;
  let relit7d = 0;
  for (const detail of Object.values(details)) {
    const events = detail.events;
    // 事件按新→旧排序，超过窗口即可中断
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (now - parseUtcDate(event.created_at).getTime() > windowMs) break;
      if (event.event_type === 'extinguished') {
        extinguished7d += 1;
      } else if (event.event_type === 'lit' && isRelit(events, i)) {
        relit7d += 1;
      }
    }
  }
  return {
    currentLit: policies.filter((policy) => policy.tree_status === 'lit').length,
    extinguished7d,
    relit7d,
  };
}

export default function PolicyReview() {
  const [policies, setPolicies] = useState<PolicyWithTreeStatus[]>([]);
  const [details, setDetails] = useState<Record<number, PolicyDetail>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getPolicyLibrary()
      .then(async (list) => {
        const detailMap: Record<number, PolicyDetail> = {};
        for (const policy of list) {
          const [cycles, events] = await Promise.all([
            getPolicyCycles(policy.id),
            getPolicyEvents(policy.id, 50),
          ]);
          detailMap[policy.id] = { policy, cycles, events };
        }
        if (cancelled) return;
        setPolicies(list);
        setDetails(detailMap);
      })
      .catch((err) => setError(String(err)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => computeSummary(policies, details), [policies, details]);

  function togglePolicy(policyId: number) {
    setExpandedId((prev) => (prev === policyId ? null : policyId));
  }

  return (
    <div className="policy-review">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="review-loading">加载复盘数据…</div>
      ) : policies.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">还没有国策</p>
          <p className="empty-desc">在国策库中添加国策后，这里会展示它的执行历史与复盘信息。</p>
        </div>
      ) : (
        <>
          {/* 区域 A：摘要快照 */}
          <div className="policy-snapshot-grid">
            <div className="policy-snapshot-card policy-snapshot-lit">
              <strong className="policy-snapshot-value">{summary.currentLit} 项</strong>
              <span className="policy-snapshot-label">当前点亮</span>
            </div>
            <div className="policy-snapshot-card policy-snapshot-out">
              <strong className="policy-snapshot-value">{summary.extinguished7d} 项</strong>
              <span className="policy-snapshot-label">最近熄灭（7天内）</span>
            </div>
            <div className="policy-snapshot-card policy-snapshot-relit">
              <strong className="policy-snapshot-value">{summary.relit7d} 项</strong>
              <span className="policy-snapshot-label">最近重新点亮（7天内）</span>
            </div>
          </div>

          {/* 区域 B：国策列表（点击展开区域 C 详情） */}
          <div className="policy-review-list-head">
            <span>名称</span>
            <span>当前状态</span>
            <span>本轮天数</span>
            <span>历史周期数</span>
            <span>累计熄灭次数</span>
          </div>

          <div className="policy-review-list">
            {policies.map((policy) => {
              const detail = details[policy.id];
              if (!detail) return null;
              const { cycles, events } = detail;
              const status = statusOf(policy);
              const latestCycle = cycles[0] ?? null;
              const currentCycle = cycles.find((cycle) => cycle.ended_at === null) ?? null;
              const extinguishedCount = events.filter(
                (event) => event.event_type === 'extinguished',
              ).length;
              const expanded = expandedId === policy.id;

              return (
                <div
                  key={policy.id}
                  className={`policy-review-card${expanded ? ' is-expanded' : ''}`}
                >
                  <button
                    type="button"
                    className="policy-review-row"
                    aria-expanded={expanded}
                    onClick={() => togglePolicy(policy.id)}
                  >
                    <span className="policy-review-name">{policy.name}</span>
                    <span className={`policy-review-status ${status.cls}`}>{status.text}</span>
                    <span className="policy-review-stat">
                      {latestCycle ? `${cycleDays(latestCycle)}天` : '—'}
                    </span>
                    <span className="policy-review-stat">{cycles.length} 轮</span>
                    <span className="policy-review-stat">{extinguishedCount} 次</span>
                  </button>

                  {expanded && (
                    <div className="policy-review-detail">
                      <h3 className="policy-detail-title">{policy.name}</h3>

                      <div className="policy-detail-stats">
                        <div className="policy-detail-stat">
                          <span>当前状态</span>
                          <strong className={`policy-detail-status ${status.cls}`}>
                            {status.text}
                          </strong>
                        </div>
                        <div className="policy-detail-stat">
                          <span>本轮已点亮</span>
                          <strong>{currentCycle ? `${cycleDays(currentCycle)}天` : '—'}</strong>
                        </div>
                        <div className="policy-detail-stat">
                          <span>历史执行周期</span>
                          <strong>{cycles.length} 轮</strong>
                        </div>
                        <div className="policy-detail-stat">
                          <span>累计熄灭</span>
                          <strong>{extinguishedCount} 次</strong>
                        </div>
                      </div>

                      {/* 区域 C：历史事件时间线 */}
                      <div className="policy-event-list">
                        {events.length === 0 ? (
                          <p className="policy-event-empty">暂无事件记录</p>
                        ) : (
                          events.map((event, index) => (
                            <div className="policy-event-item" key={event.id}>
                              <div className="policy-event-main">
                                <span className="policy-event-date">
                                  {formatMonthDay(event.created_at)}
                                </span>
                                <span className="policy-event-label">
                                  {eventLabel(events, index)}
                                </span>
                              </div>
                              {event.event_type === 'extinguished' && event.reason && (
                                <div className="policy-event-note">原因：{event.reason}</div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
