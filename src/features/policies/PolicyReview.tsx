import { useMemo, useState } from 'react';
import { usePolicy } from './PolicyProvider';
import type { PolicyCycle, PolicyEvent, TreeNodeWithPolicy } from '../../types';

const DAY_MS = 86_400_000;

/** 后端以 UTC 存储 datetime('now')，与 protocolEvents.ts 保持一致：补 Z 按 UTC 解析 */
function parseUtcDate(raw: string): Date {
  return new Date(raw + 'Z');
}

/** 事件时间线日期：今天所在年份只显示「M月D日」，跨年补充年份 */
function formatMonthDay(raw: string): string {
  const date = parseUtcDate(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const base = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (date.getFullYear() !== new Date().getFullYear()) {
    return `${date.getFullYear()}年${base}`;
  }
  return base;
}

/** 周期持续天数：把起始日算作第 1 天 */
function cycleDays(cycle: PolicyCycle): number {
  const start = parseUtcDate(cycle.started_at).getTime();
  if (Number.isNaN(start)) return 0;
  const end = cycle.ended_at ? parseUtcDate(cycle.ended_at).getTime() : Date.now();
  return Math.max(1, Math.floor((end - start) / DAY_MS) + 1);
}

interface EventMetadata {
  old_name?: string | null;
  new_name?: string | null;
  old_parent_name?: string | null;
  new_parent_name?: string | null;
}

function parseMetadata(raw: string): EventMetadata | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as EventMetadata;
  } catch {
    // 忽略无法解析的 metadata
  }
  return null;
}

/**
 * lit 事件是否为「重新点亮」：向前（更早）查找最近的状态翻转事件，
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

/** 事件 → 中文文案（events 按新→旧排序，index 为当前事件下标） */
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
      return EVENT_LABELS.renamed;
    }
    case 'reparented': {
      const meta = parseMetadata(event.metadata);
      const oldName = meta?.old_parent_name ?? null;
      const newName = meta?.new_parent_name ?? null;
      if (oldName && newName) return `调整父节点：从「${oldName}」移动到「${newName}」下`;
      if (oldName) return `调整父节点：从「${oldName}」下提升为根节点`;
      if (newName) return `调整父节点：从根节点移动到「${newName}」下`;
      return EVENT_LABELS.reparented;
    }
    default:
      return EVENT_LABELS[event.event_type];
  }
}

interface Summary {
  lit: number;
  extinguished: number;
  relit: number;
}

/** 摘要快照：当前点亮 / 最近熄灭 / 最近重亮（按"项"统计） */
function computeSummary(
  treeNodes: TreeNodeWithPolicy[],
  eventsByPolicyId: Record<number, PolicyEvent[]>,
): Summary {
  let lit = 0;
  let extinguished = 0;
  let relit = 0;
  for (const node of treeNodes) {
    if (node.status === 'lit') {
      lit += 1;
      if (wasRelit(eventsByPolicyId[node.policy_id] ?? [])) relit += 1;
    } else {
      extinguished += 1;
    }
  }
  return { lit, extinguished, relit };
}

/** 该国策是否曾经历过「熄灭 → 重新点亮」 */
function wasRelit(events: PolicyEvent[]): boolean {
  let sawExtinguished = false;
  for (const event of events) {
    if (event.event_type === 'extinguished') {
      sawExtinguished = true;
    } else if (event.event_type === 'lit' && sawExtinguished) {
      return true;
    }
  }
  return false;
}

export default function PolicyReview() {
  const { policies, treeNodes, eventsByPolicyId, cyclesByPolicyId, loading, error } = usePolicy();
  const [expandedPolicyId, setExpandedPolicyId] = useState<number | null>(null);

  const summary = useMemo(
    () => computeSummary(treeNodes, eventsByPolicyId),
    [treeNodes, eventsByPolicyId],
  );

  /** 按 policy_id 查找 tree node（可能已从树移除故为 null） */
  const nodeByPolicyId = useMemo(() => {
    const map = new Map<number, TreeNodeWithPolicy>();
    for (const n of treeNodes) map.set(n.policy_id, n);
    return map;
  }, [treeNodes]);

  if (loading) {
    return (
      <div className="review-loading">
        <p className="placeholder-text" role="status" aria-live="polite">
          正在汇总国策复盘数据...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  }

  if (policies.length === 0) {
    return (
      <div className="review-empty-card">
        <div className="empty-state">
          <p className="empty-title">还没有国策</p>
          <p className="empty-desc">创建国策后，复盘会在这里展示完整执行历史。</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 区域 A：摘要快照 */}
      <section aria-label="国策摘要快照">
        <div className="policy-snapshot-grid">
          <div className="policy-snapshot-card policy-snapshot-lit">
            <strong className="policy-snapshot-value">{summary.lit} 项</strong>
            <span className="policy-snapshot-label">当前点亮</span>
          </div>
          <div className="policy-snapshot-card policy-snapshot-out">
            <strong className="policy-snapshot-value">{summary.extinguished} 项</strong>
            <span className="policy-snapshot-label">最近熄灭</span>
          </div>
          <div className="policy-snapshot-card policy-snapshot-relit">
            <strong className="policy-snapshot-value">{summary.relit} 项</strong>
            <span className="policy-snapshot-label">最近重亮</span>
          </div>
        </div>
      </section>

      {/* 区域 B：国策列表（点击行展开区域 C 详情） */}
      <section aria-label="国策列表">
        <div className="policy-review-list-head" aria-hidden="true">
          <span>名称</span>
          <span>当前状态</span>
          <span>本轮天数</span>
          <span>历史周期数</span>
          <span>累计熄灭</span>
        </div>

        <div className="policy-review-list">
          {policies.map((policy) => {
            const node = nodeByPolicyId.get(policy.id) ?? null;
            const events = eventsByPolicyId[policy.id] ?? [];
            const cycles = cyclesByPolicyId[policy.id] ?? [];
            const expanded = expandedPolicyId === policy.id;
            return (
              <PolicyReviewCard
                key={policy.id}
                policy={policy}
                node={node}
                events={events}
                cycles={cycles}
                expanded={expanded}
                onToggle={() => setExpandedPolicyId(expanded ? null : policy.id)}
              />
            );
          })}
        </div>
      </section>
    </>
  );
}

function PolicyReviewCard({
  policy,
  node,
  events,
  cycles,
  expanded,
  onToggle,
}: {
  policy: { name: string };
  node: TreeNodeWithPolicy | null;
  events: PolicyEvent[];
  cycles: PolicyCycle[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const openCycle = cycles.find((cycle) => cycle.ended_at === null) ?? null;
  const openCycleDays = openCycle ? cycleDays(openCycle) : null;
  const cycleCount = cycles.length;
  const extinguishCount = events.filter((event) => event.event_type === 'extinguished').length;
  const status = node?.status ?? 'out';
  const statusLabel = status === 'lit' ? '点亮' : status === 'extinguished' ? '熄灭' : '不在树中';

  return (
    <article className={`policy-review-card${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="policy-review-row"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="policy-review-name">{policy.name}</span>
        <span className={`policy-review-status ${status}`}>
          {statusLabel}
        </span>
        <span className="policy-review-stat">
          {openCycleDays !== null ? `${openCycleDays}天` : '—'}
        </span>
        <span className="policy-review-stat">{cycleCount} 轮</span>
        <span className="policy-review-stat">{extinguishCount} 次</span>
      </button>

      {expanded && (
        <PolicyReviewDetail
          policyName={policy.name}
          status={status}
          statusLabel={statusLabel}
          events={events}
          openCycleDays={openCycleDays}
          cycleCount={cycleCount}
          extinguishCount={extinguishCount}
        />
      )}
    </article>
  );
}

function PolicyReviewDetail({
  policyName,
  status,
  statusLabel,
  events,
  openCycleDays,
  cycleCount,
  extinguishCount,
}: {
  policyName: string;
  status: string;
  statusLabel: string;
  events: PolicyEvent[];
  openCycleDays: number | null;
  cycleCount: number;
  extinguishCount: number;
}) {
  return (
    <div className="policy-review-detail">
      <h3 className="policy-detail-title">{policyName}</h3>

      <div className="policy-detail-stats">
        <div className="policy-detail-stat">
          <span>当前状态</span>
          <strong className={`policy-detail-status ${status}`}>
            {statusLabel}
          </strong>
        </div>
        <div className="policy-detail-stat">
          <span>本轮已点亮</span>
          <strong>{openCycleDays !== null ? `${openCycleDays}天` : '—'}</strong>
        </div>
        <div className="policy-detail-stat">
          <span>历史执行周期</span>
          <strong>{cycleCount} 轮</strong>
        </div>
        <div className="policy-detail-stat">
          <span>累计熄灭</span>
          <strong>{extinguishCount} 次</strong>
        </div>
      </div>

      {/* 区域 C：历史事件时间线 */}
      {events.length === 0 ? (
        <p className="policy-event-empty">暂无事件记录</p>
      ) : (
        <div className="policy-event-list">
          {events.map((event, index) => (
            <div className="policy-event-item" key={event.id}>
              <div className="policy-event-main">
                <span className="policy-event-date">{formatMonthDay(event.created_at)}</span>
                <span className="policy-event-label">{eventLabel(events, index)}</span>
              </div>
              {event.event_type === 'extinguished' && event.reason && (
                <div className="policy-event-note">原因：{event.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
