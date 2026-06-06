import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getFormulaEvents, getRsipFormulas, getRsipGoals, updateRsipFormula } from '../lib/db';
import { formatProtocolDateTime, formulaEventLabel } from '../lib/protocolEvents';
import type { FormulaEvent, RsipFormula, RsipGoal } from '../types';
import {
  summarizeRsipReview,
  type RsipFormulaReviewItem,
  type RsipGoalReviewItem,
} from './rsipReviewModel';

type RsipReviewTab = 'formulas' | 'events' | 'goals';

const TABS: { key: RsipReviewTab; label: string }[] = [
  { key: 'formulas', label: '定式复盘' },
  { key: 'events', label: '事件复盘' },
  { key: 'goals', label: '目标复盘' },
];

const RSIP_REVIEW_HINT =
  'RSIP复盘聚焦定式树稳定性、熄灭记录、递归回滚和目标到定式的转译质量。';

export default function RSIPReview() {
  const [tab, setTab] = useState<RsipReviewTab>('formulas');
  const [formulas, setFormulas] = useState<RsipFormula[]>([]);
  const [goals, setGoals] = useState<RsipGoal[]>([]);
  const [events, setEvents] = useState<FormulaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Master-detail state
  const [selectedFormulaId, setSelectedFormulaId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingDetail, setSavingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([getRsipFormulas(), getRsipGoals(false), getFormulaEvents(40)])
      .then(([nextFormulas, nextGoals, nextEvents]) => {
        setFormulas(nextFormulas);
        setGoals(nextGoals);
        setEvents(nextEvents);
        setError('');
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const review = useMemo(
    () => summarizeRsipReview({ formulas, goals, events }),
    [formulas, goals, events],
  );

  // URL-driven formula selection (e.g. /rsip-review?formula=123)
  useEffect(() => {
    const formulaId = Number(searchParams.get('formula'));
    if (!Number.isFinite(formulaId) || formulaId <= 0) return;
    if (review.priorityFormulas.some((item) => item.formula.id === formulaId)) {
      setSelectedFormulaId(formulaId);
      const item = review.priorityFormulas.find((i) => i.formula.id === formulaId);
      if (item) {
        setEditTitle(item.formula.title);
        setEditDescription(item.formula.description);
      }
    }
  }, [searchParams, review.priorityFormulas]);

  async function handleSaveDetail() {
    if (!selectedFormulaId || !editTitle.trim()) return;
    setSavingDetail(true);
    setDetailError('');
    try {
      await updateRsipFormula(selectedFormulaId, {
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      const refreshed = await getRsipFormulas();
      setFormulas(refreshed);
    } catch (err) {
      setDetailError(String(err));
    } finally {
      setSavingDetail(false);
    }
  }

  return (
    <div className="page review-page rsip-review-page">
      <div className="rsip-review-header">
        <div className="page-title-block">
          <h2>RSIP复盘</h2>
          <p className="page-subtitle">{RSIP_REVIEW_HINT}</p>
        </div>
        <div className="rsip-review-tabs">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`rsip-review-tab ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading ? (
        <div className="review-loading">
          <p className="placeholder-text" role="status" aria-live="polite">
            正在汇总RSIP复盘数据...
          </p>
        </div>
      ) : (
        <>
          <RsipReviewSummary review={review} />
          {tab === 'formulas' && (
            <FormulaMasterDetail
              items={review.priorityFormulas}
              selectedId={selectedFormulaId}
              onSelect={(id) => {
                setSelectedFormulaId(id);
                setSearchParams({ formula: String(id) });
                const item = review.priorityFormulas.find((i) => i.formula.id === id);
                if (item) {
                  setEditTitle(item.formula.title);
                  setEditDescription(item.formula.description);
                }
              }}
              onSave={handleSaveDetail}
              editTitle={editTitle}
              editDescription={editDescription}
              setEditTitle={setEditTitle}
              setEditDescription={setEditDescription}
              saving={savingDetail}
              error={detailError}
            />
          )}
          {tab === 'events' && <EventReviewList events={events} />}
          {tab === 'goals' && <GoalReviewList items={review.goals} />}
        </>
      )}
    </div>
  );
}

function RsipReviewSummary({
  review,
}: {
  review: ReturnType<typeof summarizeRsipReview>;
}) {
  const summary = review.summary;

  return (
    <div className="rsip-overview-card">
      <div className="rsip-overview-stats">
        <div className="rsip-overview-stat">
          <strong className="rsip-overview-stat-value">{summary.totalFormulas}</strong>
          <span className="rsip-overview-stat-label">定式总数</span>
          <span className="rsip-overview-stat-detail">根 {summary.rootFormulas} · 子 {summary.childFormulas}</span>
        </div>
        <div className="rsip-overview-stat rsip-overview-stat-positive">
          <strong className="rsip-overview-stat-value">{summary.activeFormulas}</strong>
          <span className="rsip-overview-stat-label">已点亮</span>
          <span className="rsip-overview-stat-detail">{summary.inactiveFormulas} 个未点亮</span>
        </div>
        <div className={`rsip-overview-stat ${summary.deactivationEvents > 0 ? 'rsip-overview-stat-negative' : ''}`}>
          <strong className="rsip-overview-stat-value">{summary.deactivationEvents}</strong>
          <span className="rsip-overview-stat-label">熄灭事件</span>
          <span className="rsip-overview-stat-detail">回滚 {summary.rollbackEvents} 次</span>
        </div>
        <div className="rsip-overview-stat">
          <strong className="rsip-overview-stat-value">{summary.linkedGoals}</strong>
          <span className="rsip-overview-stat-label">目标</span>
          <span className="rsip-overview-stat-detail">{summary.failurePaths} 条失败路径</span>
        </div>
      </div>

      <div className="rsip-overview-insight">
        {review.priorityFormulas.length > 0 ? (
          <span>
            优先复盘 <strong>{review.priorityFormulas[0].formula.title}</strong>
            <span className="rsip-overview-insight-sep">·</span>
            风险分 {review.priorityFormulas[0].priorityScore}
          </span>
        ) : (
          <span>当前还没有可复盘的RSIP定式</span>
        )}
      </div>
    </div>
  );
}

function FormulaMasterDetail({
  items,
  selectedId,
  onSelect,
  onSave,
  editTitle,
  editDescription,
  setEditTitle,
  setEditDescription,
  saving,
  error,
}: {
  items: RsipFormulaReviewItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSave: () => void;
  editTitle: string;
  editDescription: string;
  setEditTitle: (v: string) => void;
  setEditDescription: (v: string) => void;
  saving: boolean;
  error: string;
}) {
  if (items.length === 0) {
    return (
      <div className="review-empty-card">
        <div className="empty-state">
          <p className="empty-title">暂无RSIP定式</p>
          <p className="empty-desc">创建定式并点亮或熄灭后，RSIP复盘会在这里形成稳定性视图。</p>
        </div>
      </div>
    );
  }

  const selected = items.find((i) => i.formula.id === selectedId) ?? null;

  return (
    <div className="rsip-master-detail">
      <div className="rsip-formula-list-panel">
        <div className="rsip-formula-list-header">
          <span>{items.length} 个定式</span>
          <span className="rsip-formula-list-sort">按风险排序</span>
        </div>
        <div className="rsip-formula-list-body">
          {items.map((item) => (
            <button
              key={item.formula.id}
              className={`rsip-formula-list-item ${selectedId === item.formula.id ? 'selected' : ''}`}
              onClick={() => onSelect(item.formula.id)}
            >
              <div className="rsip-formula-list-item-top">
                <div className="rsip-formula-list-item-info">
                  <span className="rsip-formula-list-kicker">{item.goalTitle ?? '未连接目标'}</span>
                  <span className="rsip-formula-list-title">{item.formula.title}</span>
                </div>
                <span className={`review-risk-badge review-risk-${item.tone}`}>{riskLabel(item.tone)}</span>
              </div>
              <div className="rsip-formula-list-metrics">
                <span>{item.activeChildCount}/{item.childCount} active</span>
                <span className={item.deactivationEvents > 0 ? 'metric-negative' : ''}>{item.deactivationEvents} 熄灭</span>
                <span className={item.rollbackEvents > 0 ? 'metric-negative' : ''}>{item.rollbackEvents} 回滚</span>
                <span>风险 {item.priorityScore}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rsip-formula-detail-panel">
        {!selected ? (
          <div className="empty-state compact">
            <p className="empty-title">选择一个定式</p>
            <p className="empty-desc">从左侧列表选择定式查看详细复盘数据。</p>
          </div>
        ) : (
          <FormulaDetail
            item={selected}
            editTitle={editTitle}
            editDescription={editDescription}
            setEditTitle={setEditTitle}
            setEditDescription={setEditDescription}
            onSave={onSave}
            saving={saving}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

function FormulaDetail({
  item,
  editTitle,
  editDescription,
  setEditTitle,
  setEditDescription,
  onSave,
  saving,
  error,
}: {
  item: RsipFormulaReviewItem;
  editTitle: string;
  editDescription: string;
  setEditTitle: (v: string) => void;
  setEditDescription: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string;
}) {
  const { formula } = item;

  return (
    <>
      <div className="rsip-detail-header">
        <span className={`formula-status status-${formula.status}`}>
          {formula.status === 'active' ? '点亮' : '未点亮'}
        </span>
        {item.goalTitle && <span className="rsip-detail-goal-kicker">{item.goalTitle}</span>}
      </div>

      <div className="rsip-detail-edit">
        <label className="form-field">
          <span>定式标题</span>
          <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
        </label>
        <label className="form-field">
          <span>执行说明</span>
          <textarea
            rows={3}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="写清触发条件、完成标准和例外边界"
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="rsip-detail-save-row">
          <button
            className="btn btn-primary"
            disabled={saving || !editTitle.trim()}
            onClick={onSave}
          >
            {saving ? '保存中...' : '保存定式'}
          </button>
        </div>
      </div>

      <div className="rsip-detail-metrics">
        <div className="review-metric review-metric-neutral">
          <span className="review-metric-value">{item.activeChildCount}/{item.childCount}</span>
          <span className="review-metric-label">依赖子定式 active</span>
        </div>
        <div className={`review-metric ${item.deactivationEvents > 0 ? 'review-metric-negative' : 'review-metric-neutral'}`}>
          <span className="review-metric-value">{item.deactivationEvents}</span>
          <span className="review-metric-label">熄灭次数</span>
        </div>
        <div className={`review-metric ${item.rollbackEvents > 0 ? 'review-metric-negative' : 'review-metric-neutral'}`}>
          <span className="review-metric-value">{item.rollbackEvents}</span>
          <span className="review-metric-label">回滚次数</span>
        </div>
        <div className={`review-metric ${item.priorityScore >= 6 ? 'review-metric-negative' : item.priorityScore > 0 ? 'review-metric-negative' : 'review-metric-positive'}`}>
          <span className="review-metric-value">{item.priorityScore}</span>
          <span className="review-metric-label">风险分</span>
        </div>
      </div>

      {formula.dependency_note && (
        <div className="rsip-review-note-line">
          <span>依赖说明</span>
          <p>{formula.dependency_note}</p>
        </div>
      )}

      {formula.description && (
        <div className="rsip-detail-desc-section">
          <span className="rsip-detail-section-label">执行说明</span>
          <p>{formula.description}</p>
        </div>
      )}
    </>
  );
}

function EventReviewList({ events }: { events: FormulaEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="review-empty-card">
        <div className="empty-state">
          <p className="empty-title">暂无RSIP事件</p>
          <p className="empty-desc">定式创建、点亮、熄灭和递归回滚会出现在这里。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="review-failure-layout">
      <div className="review-summary-card">
        <span>
          最近 <strong>{events.length}</strong> 条RSIP事件
        </span>
        <span className="review-failure-hint">按时间倒序展示</span>
      </div>
      <div className="review-failure-list">
        {events.map((event) => (
          <article key={event.id} className="review-failure-card rsip-event-review-card">
            <div className="review-failure-head">
              <span className="review-failure-category">{event.formula_title}</span>
              <span className={`formula-event-type event-${event.event_type}`}>
                {formulaEventLabel(event.event_type)}
              </span>
            </div>
            <div className="review-failure-meta">
              <span>{formatProtocolDateTime(event.created_at)}</span>
              <span>定式 #{event.formula_id}</span>
            </div>
            {event.note && <p className="review-failure-note">{event.note}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}

function GoalReviewList({ items }: { items: RsipGoalReviewItem[] }) {
  if (items.length === 0) {
    return (
      <div className="review-empty-card">
        <div className="empty-state">
          <p className="empty-title">暂无RSIP目标</p>
          <p className="empty-desc">从目标转译出定式后，这里会显示目标下的定式稳定性。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rsip-review-goal-grid">
      {items.map((item) => (
        <article key={item.goal.id} className="rsip-goal-card">
          <div>
            <span className="formula-status status-active">active</span>
            <h4>{item.goal.title}</h4>
            {item.goal.description && <p>{item.goal.description}</p>}
          </div>
          <div className="rsip-goal-stats">
            <span>{item.formulaCount} 定式</span>
            <span>{item.activeFormulaCount} 点亮</span>
            <span>{item.inactiveFormulaCount} 未点亮</span>
            <span>{item.goal.failure_path_count} 失败路径</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function riskLabel(tone: RsipFormulaReviewItem['tone']): string {
  if (tone === 'high') return '高风险';
  if (tone === 'watch') return '关注';
  return '稳定';
}
