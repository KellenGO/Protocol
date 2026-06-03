import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  activateRsipFormula,
  createRsipFormula,
  deactivateRsipFormula,
  getFormulaEvents,
  getRsipFormulaReview,
  getRsipFormulas,
  updateRsipFormula,
} from '../lib/db';
import { formatProtocolDateTime, formulaEventLabel } from '../lib/protocolEvents';
import type { FormulaEvent, FormulaReview, RsipFormula } from '../types';

interface FormulaNode extends RsipFormula {
  children: FormulaNode[];
}

function buildTree(formulas: RsipFormula[]): FormulaNode[] {
  const map = new Map<number, FormulaNode>();
  formulas.forEach((f) => map.set(f.id, { ...f, children: [] }));

  const roots: FormulaNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (nodes: FormulaNode[]) => {
    nodes.sort((a, b) => a.position - b.position || a.id - b.id);
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export default function RSIP() {
  const [searchParams] = useSearchParams();
  const [formulas, setFormulas] = useState<RsipFormula[]>([]);
  const [events, setEvents] = useState<FormulaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [review, setReview] = useState<FormulaReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewDescription, setReviewDescription] = useState('');
  const [deactivationNote, setDeactivationNote] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [savingReview, setSavingReview] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  const tree = useMemo(() => buildTree(formulas), [formulas]);
  const activeCount = formulas.filter((f) => f.status === 'active').length;
  const reviewChanged = review
    ? reviewTitle.trim() !== review.formula.title ||
      reviewDescription.trim() !== review.formula.description
    : false;

  async function reload() {
    const [nextFormulas, nextEvents] = await Promise.all([
      getRsipFormulas(),
      getFormulaEvents(12),
    ]);
    setFormulas(nextFormulas);
    setEvents(nextEvents);
  }

  async function loadReview(id: number) {
    setReviewLoading(true);
    setError('');
    try {
      const nextReview = await getRsipFormulaReview(id);
      setReview(nextReview);
      setReviewTitle(nextReview.formula.title);
      setReviewDescription(nextReview.formula.description);
      setDeactivationNote('');
    } catch (err) {
      setError(String(err));
    } finally {
      setReviewLoading(false);
    }
  }

  useEffect(() => {
    reload()
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const formulaId = Number(searchParams.get('formula'));
    if (!Number.isFinite(formulaId) || formulaId <= 0) return;
    loadReview(formulaId);
  }, [searchParams]);

  async function handleCreate() {
    if (!title.trim()) {
      setFormError('定式标题不能为空');
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      await createRsipFormula({
        title: title.trim(),
        description: description.trim(),
        parentId,
      });
      setTitle('');
      setDescription('');
      setParentId(null);
      await reload();
    } catch (err) {
      setFormError(String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleActivate(id: number) {
    setWorkingId(id);
    setError('');
    try {
      await activateRsipFormula(id);
      await reload();
      if (review?.formula.id === id) await loadReview(id);
    } catch (err) {
      setError(String(err));
    } finally {
      setWorkingId(null);
    }
  }

  async function handleDeactivate(id: number) {
    setWorkingId(id);
    setError('');
    try {
      await deactivateRsipFormula(id, review?.formula.id === id ? deactivationNote : undefined);
      await reload();
      if (review?.formula.id === id) await loadReview(id);
    } catch (err) {
      setError(String(err));
    } finally {
      setWorkingId(null);
    }
  }

  async function handleSaveReview() {
    if (!review) return;
    if (!reviewTitle.trim()) {
      setReviewError('定式标题不能为空');
      return;
    }
    setSavingReview(true);
    setReviewError('');
    try {
      const updated = await updateRsipFormula(review.formula.id, {
        title: reviewTitle,
        description: reviewDescription,
      });
      setReview({ ...review, formula: updated });
      setReviewTitle(updated.title);
      setReviewDescription(updated.description);
      await reload();
    } catch (err) {
      setReviewError(String(err));
    } finally {
      setSavingReview(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>RSIP 定式树</h2>
          <p className="page-subtitle">
            用低阻力定式递归改善生活稳态；父节点熄灭时，active 子节点会同步回滚。
          </p>
        </div>
      </div>

      <div className="rsip-summary-grid">
        <div className="stat-card">
          <span className="stat-label">定式总数</span>
          <span className="stat-value">{formulas.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">已点亮</span>
          <span className="stat-value">{activeCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">未点亮</span>
          <span className="stat-value">{formulas.length - activeCount}</span>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="rsip-layout">
        <section className="rsip-tree-panel">
          <div className="section-header">
            <h3>定式树</h3>
            <span className="section-hint">每天最多新增一个定式更符合 RSIP 原意</span>
          </div>
          {loading ? (
            <p className="placeholder-text">加载中…</p>
          ) : tree.length === 0 ? (
            <div className="empty-state compact">
              <p className="empty-title">还没有定式</p>
              <p className="empty-desc">
                先创建一个足够小、足够容易存活的根定式。
              </p>
            </div>
          ) : (
            <div className="formula-tree">
              {tree.map((node) => (
                <FormulaTreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  workingId={workingId}
                  onAddChild={(id) => setParentId(id)}
                  onReview={loadReview}
                  onActivate={handleActivate}
                  onDeactivate={handleDeactivate}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="rsip-side-panel">
          <RsipReviewPanel
            review={review}
            loading={reviewLoading}
            title={reviewTitle}
            description={reviewDescription}
            deactivationNote={deactivationNote}
            error={reviewError}
            saving={savingReview}
            canSave={reviewChanged && Boolean(reviewTitle.trim())}
            setTitle={setReviewTitle}
            setDescription={setReviewDescription}
            setDeactivationNote={setDeactivationNote}
            onSave={handleSaveReview}
          />

          <section className="rsip-create-card">
            <h3>{parentId ? '创建子定式' : '创建根定式'}</h3>
            {parentId && (
              <p className="selected-parent">
                父定式：{formulas.find((f) => f.id === parentId)?.title ?? `#${parentId}`}
                <button className="link-button" onClick={() => setParentId(null)}>
                  改为根定式
                </button>
              </p>
            )}

            <label className="form-field">
              <span>定式标题</span>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setFormError('');
                }}
                placeholder="例如：饭后 10 分钟内洗碗"
              />
            </label>

            <label className="form-field">
              <span>执行说明</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="写清触发条件、完成标准和例外边界"
                rows={4}
              />
            </label>

            {formError && <p className="form-error">{formError}</p>}

            <button className="btn btn-primary" disabled={creating} onClick={handleCreate}>
              {creating ? '创建中…' : '写入定式树'}
            </button>
          </section>

          <section className="rsip-events-card">
            <h3>最近 RSIP 事件</h3>
            {events.length === 0 ? (
              <p className="placeholder-text">暂无定式事件</p>
            ) : (
              <div className="formula-events">
                {events.map((event) => (
                  <div key={event.id} className="formula-event">
                    <div className="formula-event-main">
                      <span className={`formula-event-type event-${event.event_type}`}>
                        {formulaEventLabel(event.event_type)}
                      </span>
                      <span className="formula-event-title">{event.formula_title}</span>
                    </div>
                    <span className="formula-event-time">{formatProtocolDateTime(event.created_at)}</span>
                    {event.note && <p className="formula-event-note">{event.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function FormulaTreeNode({
  node,
  depth,
  workingId,
  onAddChild,
  onReview,
  onActivate,
  onDeactivate,
}: {
  node: FormulaNode;
  depth: number;
  workingId: number | null;
  onAddChild: (id: number) => void;
  onReview: (id: number) => void;
  onActivate: (id: number) => void;
  onDeactivate: (id: number) => void;
}) {
  const activeChildren = countActive(node.children);
  const isWorking = workingId === node.id;

  return (
    <div className="formula-node-wrap">
      <div className="formula-node" style={{ marginLeft: depth * 22 }}>
        <div className="formula-node-main">
          <span className={`formula-status status-${node.status}`}>
            {node.status === 'active' ? '点亮' : '未点亮'}
          </span>
          <div className="formula-node-copy">
            <span className="formula-node-title">{node.title}</span>
            {node.description && (
              <span className="formula-node-desc">{node.description}</span>
            )}
            <span className="formula-node-meta">
              子定式 {node.children.length} 个 · active 子定式 {activeChildren} 个
            </span>
          </div>
        </div>
        <div className="formula-node-actions">
          <button className="btn btn-secondary" onClick={() => onReview(node.id)}>
            复盘
          </button>
          <button className="btn btn-secondary" onClick={() => onAddChild(node.id)}>
            加子定式
          </button>
          {node.status === 'active' ? (
            <button
              className="btn-danger-outline compact-btn"
              disabled={isWorking}
              onClick={() => onDeactivate(node.id)}
            >
              熄灭
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={isWorking}
              onClick={() => onActivate(node.id)}
            >
              点亮
            </button>
          )}
        </div>
      </div>
      {node.children.map((child) => (
        <FormulaTreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          workingId={workingId}
          onAddChild={onAddChild}
          onReview={onReview}
          onActivate={onActivate}
          onDeactivate={onDeactivate}
        />
      ))}
    </div>
  );
}

function RsipReviewPanel({
  review,
  loading,
  title,
  description,
  deactivationNote,
  error,
  saving,
  canSave,
  setTitle,
  setDescription,
  setDeactivationNote,
  onSave,
}: {
  review: FormulaReview | null;
  loading: boolean;
  title: string;
  description: string;
  deactivationNote: string;
  error: string;
  saving: boolean;
  canSave: boolean;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setDeactivationNote: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="rsip-review-card">
      <h3>定式复盘</h3>
      {loading ? (
        <p className="placeholder-text">复盘加载中...</p>
      ) : !review ? (
        <p className="placeholder-text">在定式树中选择一个定式进行复盘。</p>
      ) : (
        <>
          <div className="rsip-review-head">
            <span className={`formula-status status-${review.formula.status}`}>
              {review.formula.status === 'active' ? '点亮' : '未点亮'}
            </span>
            <strong>{review.formula.title}</strong>
          </div>
          <div className="rsip-edit-fields">
            <label className="form-field">
              <span>定式标题</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="form-field">
              <span>执行说明</span>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="写清触发条件、完成标准和例外边界"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn btn-primary" disabled={saving || !canSave} onClick={onSave}>
              {saving ? '保存中...' : '保存定式'}
            </button>
          </div>
          <div className="rsip-review-grid">
            <ReviewMetric label="创建" value={formatProtocolDateTime(review.formula.created_at)} />
            <ReviewMetric label="点亮" value={review.formula.activated_at ? formatProtocolDateTime(review.formula.activated_at) : '-'} />
            <ReviewMetric label="熄灭" value={review.formula.deactivated_at ? formatProtocolDateTime(review.formula.deactivated_at) : '-'} />
            <ReviewMetric label="依赖子定式" value={`${review.active_child_count}/${review.child_count} active`} />
            <ReviewMetric label="回滚影响" value={`${review.rollback_event_count} 次`} />
          </div>
          <div className="rsip-review-note">
            <span>最近熄灭裁定</span>
            <p>{review.latest_deactivation_note || '暂无熄灭备注'}</p>
          </div>
          <label className="form-field rsip-deactivation-note">
            <span>下次熄灭备注</span>
            <textarea
              rows={3}
              value={deactivationNote}
              onChange={(e) => setDeactivationNote(e.target.value)}
              placeholder="例如：父定式失稳、环境变化、完成条件过高"
            />
          </label>
          <div className="formula-events compact-events">
            {review.events.length === 0 ? (
              <p className="placeholder-text">暂无事件</p>
            ) : (
              review.events.map((event) => (
                <div key={event.id} className="formula-event">
                  <div className="formula-event-main">
                    <span className={`formula-event-type event-${event.event_type}`}>
                      {formulaEventLabel(event.event_type)}
                    </span>
                  </div>
                  <span className="formula-event-time">{formatProtocolDateTime(event.created_at)}</span>
                  {event.note && <p className="formula-event-note">{event.note}</p>}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rsip-review-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function countActive(nodes: FormulaNode[]): number {
  return nodes.reduce((sum, node) => {
    return sum + (node.status === 'active' ? 1 : 0) + countActive(node.children);
  }, 0);
}
