import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  activateRsipFormula,
  archiveRsipGoal,
  createFailurePath,
  createFormulaFromGoal,
  createRsipGoal,
  createRsipFormula,
  deactivateRsipFormula,
  getFormulaEvents,
  getFailurePaths,
  getRsipGoals,
  getRsipFormulas,
  updateRsipFormula,
} from '../lib/db';
import { formatProtocolDateTime, formulaEventLabel } from '../lib/protocolEvents';
import {
  buildFormulaTree,
  findFormulaPath,
  getContentBounds,
  layoutForest,
  type FormulaTreeNode,
} from '../features/rsip/formulaTreeLayout';
import type { FailurePathNode, FormulaEvent, RsipFailurePath, RsipFormula, RsipGoal } from '../types';

type ActionFeedback = {
  tone: 'success' | 'neutral';
  text: string;
};

function normalizeFormulaTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export default function RSIP() {
  const navigate = useNavigate();
  const [formulas, setFormulas] = useState<RsipFormula[]>([]);
  const [goals, setGoals] = useState<RsipGoal[]>([]);
  const [goalPaths, setGoalPaths] = useState<RsipFailurePath[]>([]);
  const [events, setEvents] = useState<FormulaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'goals'>('tree');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null);
  const [archivingGoalId, setArchivingGoalId] = useState<number | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [selectedFormulaId, setSelectedFormulaId] = useState<number | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const tree = useMemo(() => buildFormulaTree(formulas), [formulas]);
  const activeCount = formulas.filter((f) => f.status === 'active').length;
  const selectedFormula = selectedFormulaId
    ? formulas.find((formula) => formula.id === selectedFormulaId) ?? null
    : null;
  const treeDepth = getTreeDepth(tree);
  const currentGoal = goals.find((goal) => goal.id === selectedGoalId) ?? null;
  const goalFormulas = selectedGoalId
    ? formulas.filter((formula) => formula.goal_id === selectedGoalId)
    : [];
  async function reload() {
    const [nextFormulas, nextEvents, nextGoals] = await Promise.all([
      getRsipFormulas(),
      getFormulaEvents(12),
      getRsipGoals(false),
    ]);
    setFormulas(nextFormulas);
    setEvents(nextEvents);
    setGoals(nextGoals);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = window.setTimeout(() => setActionFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);

  useEffect(() => {
    if (tree.length === 0) {
      setSelectedFormulaId(null);
      return;
    }
    if (!selectedFormulaId || !formulas.some((formula) => formula.id === selectedFormulaId)) {
      setSelectedFormulaId(tree[0].id);
    }
  }, [formulas, selectedFormulaId, tree]);

  useEffect(() => {
    setEditTitle(selectedFormula?.title ?? '');
    setEditDescription(selectedFormula?.description ?? '');
    setEditError('');
  }, [selectedFormula]);

  async function handleCreate() {
    if (!title.trim()) {
      setFormError('习惯名称不能为空');
      return;
    }
    const normalizedTitle = normalizeFormulaTitle(title);
    const duplicateSibling = formulas.some(
      (formula) =>
        formula.parent_id === parentId &&
        normalizeFormulaTitle(formula.title) === normalizedTitle,
    );
    if (duplicateSibling) {
      setFormError(parentId ? '同一父节点下不能添加同名习惯节点。' : '同一层级下已经有同名习惯节点。');
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      const createdTitle = title.trim();
      const created = await createRsipFormula({
        title: createdTitle,
        description: description.trim(),
        parentId,
      });
      setTitle('');
      setDescription('');
      setParentId(null);
      setShowCreateForm(false);
      await reload();
      setSelectedFormulaId(created.id);
      setActionFeedback({
        tone: 'success',
        text: `已写入「${createdTitle}」，可以继续点亮、添加子节点或进入复盘。`,
      });
    } catch (err) {
      setFormError(String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleActivate(id: number) {
    setWorkingId(id);
    setError('');
    setActionFeedback(null);
    try {
      await activateRsipFormula(id);
      await reload();
      setActionFeedback({
        tone: 'success',
        text: `已点亮「${formulas.find((formula) => formula.id === id)?.title ?? `#${id}`}」。`,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setWorkingId(null);
    }
  }

  async function handleDeactivate(id: number) {
    setWorkingId(id);
    setError('');
    setActionFeedback(null);
    try {
      await deactivateRsipFormula(id);
      await reload();
      setActionFeedback({
        tone: 'success',
        text: `已熄灭「${formulas.find((formula) => formula.id === id)?.title ?? `#${id}`}」，关联子节点会同步回滚。`,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setWorkingId(null);
    }
  }

  async function handleSaveFormulaEdit(formula: RsipFormula) {
    if (!editTitle.trim()) {
      setEditError('习惯名称不能为空。');
      return;
    }
    const normalizedTitle = normalizeFormulaTitle(editTitle);
    const duplicateSibling = formulas.some(
      (item) =>
        item.id !== formula.id &&
        item.parent_id === formula.parent_id &&
        normalizeFormulaTitle(item.title) === normalizedTitle,
    );
    if (duplicateSibling) {
      setEditError(formula.parent_id ? '同一父节点下不能改成同名习惯节点。' : '同一层级下已经有同名习惯节点。');
      return;
    }

    setSavingEdit(true);
    setEditError('');
    try {
      await updateRsipFormula(formula.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      await reload();
      setSelectedFormulaId(formula.id);
      setActionFeedback({
        tone: 'success',
        text: `已更新「${editTitle.trim()}」。`,
      });
    } catch (err) {
      setEditError(String(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleViewGoal(goalId: number) {
    setSelectedGoalId(goalId);
    setViewMode('goals');
    setError('');
    setActionFeedback(null);
    try {
      setGoalPaths(await getFailurePaths(goalId));
      setActionFeedback({
        tone: 'neutral',
        text: `已载入「${goals.find((goal) => goal.id === goalId)?.title ?? `#${goalId}`}」的失败路径和关联习惯节点。`,
      });
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleArchiveGoal(goalId: number) {
    setArchivingGoalId(goalId);
    setError('');
    setActionFeedback(null);
    try {
      const archivedTitle = goals.find((goal) => goal.id === goalId)?.title ?? `#${goalId}`;
      await archiveRsipGoal(goalId);
      if (selectedGoalId === goalId) {
        setSelectedGoalId(null);
        setGoalPaths([]);
      }
      await reload();
      setActionFeedback({
        tone: 'success',
        text: `已归档「${archivedTitle}」，列表会隐藏这个目标。`,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setArchivingGoalId(null);
    }
  }

  async function handleWizardComplete(_formula: RsipFormula, goalId: number) {
    setWizardOpen(false);
    setSelectedGoalId(goalId);
    await reload();
    setViewMode('tree');
    setSelectedFormulaId(_formula.id);
    setActionFeedback({
      tone: 'success',
      text: `目标转译完成：已生成「${_formula.title}」，现在可以点亮或进入复盘。`,
    });
  }

  return (
    <div className="page rsip-page">
      <div className="rsip-header-bar">
        <div className="rsip-header-left">
          <h2>RSIP 国策树</h2>
          <p className="page-subtitle">
            一个根习惯，通过依赖关系向下生长；单击节点后在右侧查看和编辑。
          </p>
        </div>
        <div className="rsip-header-right">
          <div className="rsip-view-toggle" role="tablist" aria-label="国策树视图">
            <button
              type="button"
              className={viewMode === 'tree' ? 'active' : ''}
              onClick={() => setViewMode('tree')}
              role="tab"
              aria-selected={viewMode === 'tree'}
            >
              国策树
            </button>
            <button
              type="button"
              className={viewMode === 'goals' ? 'active' : ''}
              onClick={() => setViewMode('goals')}
              role="tab"
              aria-selected={viewMode === 'goals'}
            >
              目标
            </button>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setShowCreateForm((prev) => !prev);
              setParentId(null);
            }}
          >
            + 创建习惯节点
          </button>
          <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
            新建目标转译
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/rsip-review')}>
            打开复盘
          </button>
        </div>
      </div>

      {showCreateForm && (
        <section className="rsip-create-form">
          <h3>{parentId ? '创建子习惯节点' : '创建根习惯节点'}</h3>
          {parentId && (
            <p className="selected-parent">
              父节点：{formulas.find((f) => f.id === parentId)?.title ?? `#${parentId}`}
              <button className="link-button" onClick={() => setParentId(null)}>
                改为根节点
              </button>
            </p>
          )}

          <label className="form-field">
            <span>习惯名称</span>
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

          {formError && <p className="form-error" role="alert">{formError}</p>}

          <button className="btn btn-primary" disabled={creating} onClick={handleCreate}>
            {creating ? '创建中…' : '写入国策树'}
          </button>
        </section>
      )}

      <div className="rsip-stats-bar">
        <div className="rsip-stat-item">
          <strong>{formulas.length}</strong>
          <span>习惯节点</span>
        </div>
        <div className="rsip-stat-item positive">
          <strong>{activeCount}</strong>
          <span>已点亮</span>
        </div>
        <div className="rsip-stat-item muted">
          <strong>{treeDepth}</strong>
          <span>树的深度</span>
        </div>
        <div className="rsip-stat-item">
          <strong>{tree.length}</strong>
          <span>根节点</span>
        </div>
      </div>

      {actionFeedback && (
        <div className={`rsip-feedback-toast ${actionFeedback.tone}`} role="status" aria-live="polite">
          <div className="rsip-feedback-toast-marker" />
          <p>{actionFeedback.text}</p>
          <button
            type="button"
            className="rsip-feedback-toast-close"
            aria-label="关闭国策树操作提示"
            onClick={() => setActionFeedback(null)}
          >
            ×
          </button>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {wizardOpen && (
        <GoalTranslationWizard
          goals={goals}
          formulas={formulas}
          initialGoalId={selectedGoalId}
          onCancel={() => setWizardOpen(false)}
          onComplete={handleWizardComplete}
        />
      )}

      {viewMode === 'tree' ? (
        <div className="rsip-main-layout">
          <section className="rsip-tree-panel">
            <div className="section-header">
              <h3>习惯节点图</h3>
              <span className="section-hint">纵向紧凑布局</span>
            </div>
            {loading ? (
              <p className="placeholder-text" role="status" aria-live="polite">加载中…</p>
            ) : tree.length === 0 ? (
              <div className="empty-state compact" aria-live="polite">
                <p className="empty-title">还没有习惯节点</p>
                <p className="empty-desc">
                  先创建一个足够小、足够容易存活的根习惯节点。
                </p>
              </div>
            ) : (
              <FormulaTreeGraph
                roots={tree}
                selectedFormulaId={selectedFormulaId}
                onSelect={setSelectedFormulaId}
              />
            )}
          </section>

          <aside className="rsip-detail-sidebar">
            <FormulaDetailPanel
              key={selectedFormula?.id ?? 'empty'}
              formula={selectedFormula}
              workingId={workingId}
              editTitle={editTitle}
              editDescription={editDescription}
              editError={editError}
              savingEdit={savingEdit}
              onSaveEdit={handleSaveFormulaEdit}
              setEditTitle={setEditTitle}
              setEditDescription={setEditDescription}
              onReview={(id) => navigate(`/rsip-review?formula=${id}`)}
              onAddChild={(id) => {
                setParentId(id);
                setShowCreateForm(true);
              }}
              onActivate={handleActivate}
              onDeactivate={handleDeactivate}
            />

            <section className="rsip-events-panel">
              <div className="rsip-events-header">
                <h3>最近国策树事件</h3>
                <span className="section-hint">{events.length} 条</span>
              </div>
              {events.length === 0 ? (
                <p className="placeholder-text" aria-live="polite">暂无习惯节点事件</p>
              ) : (
                <div className="rsip-events-compact">
                  {events.slice(0, 6).map((event) => (
                    <div key={event.id} className="rsip-event-row">
                      <span className={`formula-event-type event-${event.event_type}`}>
                        {formulaEventLabel(event.event_type)}
                      </span>
                      <span className="rsip-event-row-title">{event.formula_title}</span>
                      <span className="rsip-event-row-time">{formatProtocolDateTime(event.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      ) : (
        <GoalListView
          goals={goals}
          selectedGoal={currentGoal}
          selectedGoalFormulas={goalFormulas}
          selectedGoalPaths={goalPaths}
          loading={loading}
          archivingGoalId={archivingGoalId}
          onViewGoal={handleViewGoal}
          onContinue={(goalId) => {
            setSelectedGoalId(goalId);
            setWizardOpen(true);
          }}
          onArchive={handleArchiveGoal}
        />
      )}
    </div>
  );
}

function GoalListView({
  goals,
  selectedGoal,
  selectedGoalFormulas,
  selectedGoalPaths,
  loading,
  archivingGoalId,
  onViewGoal,
  onContinue,
  onArchive,
}: {
  goals: RsipGoal[];
  selectedGoal: RsipGoal | null;
  selectedGoalFormulas: RsipFormula[];
  selectedGoalPaths: RsipFailurePath[];
  loading: boolean;
  archivingGoalId: number | null;
  onViewGoal: (goalId: number) => void;
  onContinue: (goalId: number) => void;
  onArchive: (goalId: number) => void;
}) {
  if (loading) {
    return <p className="placeholder-text" role="status" aria-live="polite">目标加载中...</p>;
  }

  return (
    <div className="rsip-goal-layout">
      <section className="rsip-goals-panel">
        <div className="section-header">
          <h3>目标视角</h3>
          <span className="section-hint">目标是方向，习惯节点才是协议</span>
        </div>
        {goals.length === 0 ? (
          <div className="empty-state compact" aria-live="polite">
            <p className="empty-title">还没有目标</p>
            <p className="empty-desc">先把一个宏观方向转译成失败路径和低阻力习惯节点。</p>
          </div>
        ) : (
          <div className="rsip-goal-grid">
            {goals.map((goal) => (
              <article
                key={goal.id}
                className={`rsip-goal-card ${selectedGoal?.id === goal.id ? 'selected' : ''}`}
              >
                <div>
                  <span className="formula-status status-active">active</span>
                  <h4>{goal.title}</h4>
                  {goal.description && <p>{goal.description}</p>}
                </div>
                <div className="rsip-goal-stats">
                  <span>{goal.formula_count} 习惯节点</span>
                  <span>{goal.failure_path_count} 失败路径</span>
                </div>
                <div className="formula-node-actions">
                  <button className="btn btn-secondary" onClick={() => onViewGoal(goal.id)}>
                    查看
                  </button>
                  <button className="btn btn-secondary" onClick={() => onContinue(goal.id)}>
                    继续转译
                  </button>
                  <button
                    className="btn-danger-outline compact-btn"
                    disabled={archivingGoalId === goal.id}
                    onClick={() => onArchive(goal.id)}
                  >
                    归档
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <aside className="rsip-goal-detail">
        {!selectedGoal ? (
          <p className="placeholder-text">选择一个目标，查看它下面的失败路径和关联习惯节点。</p>
        ) : (
          <>
            <div className="section-header">
              <h3>{selectedGoal.title}</h3>
              <span className="section-hint">一个目标可以关联多个根习惯节点</span>
            </div>
            <div className="goal-detail-block">
              <span>失败路径</span>
              {selectedGoalPaths.length === 0 ? (
                <p className="placeholder-text">还没有失败路径记录。</p>
              ) : (
                selectedGoalPaths.map((path) => (
                  <div key={path.id} className="failure-path-card">
                    <strong>{path.title}</strong>
                    <ol>
                      {parseFailurePathNodes(path.nodes_json).map((node) => (
                        <li key={node.id}>{node.text}</li>
                      ))}
                    </ol>
                  </div>
                ))
              )}
            </div>
            <div className="goal-detail-block">
              <span>关联习惯节点</span>
              {selectedGoalFormulas.length === 0 ? (
                <p className="placeholder-text">还没有从该目标生成习惯节点。</p>
              ) : (
                <div className="formula-events">
                  {selectedGoalFormulas.map((formula) => (
                    <div key={formula.id} className="formula-event">
                      <div className="formula-event-main">
                        <span className={`formula-status status-${formula.status}`}>
                          {formula.status}
                        </span>
                        <span className="formula-event-title">{formula.title}</span>
                      </div>
                      {formula.dependency_note && (
                        <p className="formula-event-note">{formula.dependency_note}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function GoalTranslationWizard({
  goals,
  formulas,
  initialGoalId,
  onCancel,
  onComplete,
}: {
  goals: RsipGoal[];
  formulas: RsipFormula[];
  initialGoalId: number | null;
  onCancel: () => void;
  onComplete: (formula: RsipFormula, goalId: number) => void;
}) {
  const [step, setStep] = useState(1);
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(initialGoalId);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [failurePathText, setFailurePathText] = useState('');
  const [interventionNodeId, setInterventionNodeId] = useState('');
  const [formulaTitle, setFormulaTitle] = useState('');
  const [formulaDescription, setFormulaDescription] = useState('');
  const [parentFormulaId, setParentFormulaId] = useState('');
  const [dependencyNote, setDependencyNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId) ?? null;
  const pathNodes = useMemo(() => {
    return failurePathText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text, index) => ({ id: `node-${index + 1}`, text }));
  }, [failurePathText]);
  const parentId = parentFormulaId ? Number(parentFormulaId) : null;
  const parentOptions = selectedGoalId
    ? formulas.filter((formula) => formula.goal_id === selectedGoalId)
    : formulas;

  function nextStep() {
    setError('');
    if (step === 1 && !selectedGoalId && !goalTitle.trim()) {
      setError('请先输入目标，目标只是方向，不是直接执行项。');
      return;
    }
    if (step === 2 && pathNodes.length === 0) {
      setError('请至少写下一个失败路径节点。');
      return;
    }
    if (step === 3 && !interventionNodeId) {
      setError('请选择一个低阻力干预节点。');
      return;
    }
    setStep((current) => Math.min(current + 1, 4));
  }

  async function submit() {
    if (!formulaTitle.trim()) {
      setError('习惯名称不能为空。');
      return;
    }
    const duplicateSibling = formulas.some(
      (formula) =>
        formula.parent_id === parentId &&
        normalizeFormulaTitle(formula.title) === normalizeFormulaTitle(formulaTitle),
    );
    if (duplicateSibling) {
      setError(parentId ? '同一父节点下不能添加同名习惯节点。' : '同一层级下已经有同名习惯节点。');
      return;
    }
    if (parentId && !dependencyNote.trim()) {
      setError('选择父节点时，需要说明这个习惯为什么依赖父节点。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let goalId = selectedGoalId;
      if (!goalId) {
        const goal = await createRsipGoal({
          title: goalTitle.trim(),
          description: goalDescription.trim(),
        });
        goalId = goal.id;
      }
      const path = await createFailurePath({
        goalId,
        title: `${selectedGoal?.title ?? goalTitle.trim()} 失败路径`,
        nodes: pathNodes.map((node) => node.text),
      });
      const formula = await createFormulaFromGoal({
        goalId,
        failurePathId: path.id,
        interventionNodeId,
        title: formulaTitle.trim(),
        description: formulaDescription.trim(),
        parentId,
        dependencyNote: parentId ? dependencyNote.trim() : null,
      });
      onComplete(formula, goalId);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="goal-wizard" aria-labelledby="goal-wizard-heading">
      <div className="section-header">
        <div>
          <h3 id="goal-wizard-heading">目标转译</h3>
          <span className="section-hint">目标是方向，习惯节点才是协议。</span>
        </div>
        <button className="btn btn-secondary" onClick={onCancel}>关闭</button>
      </div>

      <div className="goal-wizard-steps" aria-label="goal translation steps">
        {[1, 2, 3, 4].map((item) => (
          <span key={item} className={step === item ? 'active' : ''}>{item}</span>
        ))}
      </div>

      {step === 1 && (
        <div className="goal-wizard-body">
          <label className="form-field">
            <span>使用已有目标</span>
            <select
              value={selectedGoalId ?? ''}
              onChange={(event) => setSelectedGoalId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">创建新目标</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>{goal.title}</option>
              ))}
            </select>
          </label>
          {!selectedGoalId && (
            <>
              <label className="form-field">
                <span>你想改变什么长期状态？</span>
                <input
                  value={goalTitle}
                  onChange={(event) => setGoalTitle(event.target.value)}
                  placeholder="例如：早睡、少刷手机、稳定学习、按时出门"
                />
              </label>
              <label className="form-field">
                <span>目标说明</span>
                <textarea
                  rows={3}
                  value={goalDescription}
                  onChange={(event) => setGoalDescription(event.target.value)}
                  placeholder="目标不会直接执行，Protocol 会把它转译成可执行习惯节点。"
                />
              </label>
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="goal-wizard-body">
          <label className="form-field">
            <span>你通常是怎么失败的？</span>
            <textarea
              rows={7}
              value={failurePathText}
              onChange={(event) => {
                setFailurePathText(event.target.value);
                setInterventionNodeId('');
              }}
              placeholder={'洗完澡\n躺下\n拿起手机\n打开短视频\n刷一个\n越刷越晚'}
            />
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="goal-wizard-body">
          <p className="dependency-guidance">
            越早干预，越可能改变后续路径；但干预点必须足够低阻力。
          </p>
          <div className="failure-node-list">
            {pathNodes.map((node) => (
              <button
                key={node.id}
                className={`intervention-option ${interventionNodeId === node.id ? 'selected' : ''}`}
                onClick={() => setInterventionNodeId(node.id)}
              >
                <span>{node.id}</span>
                {node.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="goal-wizard-body">
          <label className="form-field">
            <span>习惯名称</span>
            <input
              value={formulaTitle}
              onChange={(event) => setFormulaTitle(event.target.value)}
              placeholder="例如：手机不上床"
            />
          </label>
          <label className="form-field">
            <span>执行说明</span>
            <textarea
              rows={4}
              value={formulaDescription}
              onChange={(event) => setFormulaDescription(event.target.value)}
              placeholder="例如：上床前手机放到书桌充电，不带上床。"
            />
          </label>
          <label className="form-field">
            <span>是否作为已有习惯节点的子节点</span>
            <select value={parentFormulaId} onChange={(event) => setParentFormulaId(event.target.value)}>
              <option value="">作为根习惯节点</option>
              {parentOptions.map((formula) => (
                <option key={formula.id} value={formula.id}>{formula.title}</option>
              ))}
            </select>
          </label>
          {parentId && (
            <label className="form-field">
              <span>依赖说明</span>
              <textarea
                rows={3}
                value={dependencyNote}
                onChange={(event) => setDependencyNote(event.target.value)}
                placeholder="如果父节点失败，这个子节点是否大概率也无法稳定执行？请写明依赖理由。"
              />
            </label>
          )}
          <p className="dependency-guidance">
            子节点不是相关规则，而是依赖规则。不依赖父节点的习惯，更适合作为根习惯节点。
          </p>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="goal-wizard-actions">
        <button className="btn btn-secondary" disabled={step === 1 || saving} onClick={() => setStep((current) => current - 1)}>
          上一步
        </button>
        {step < 4 ? (
          <button className="btn btn-primary" onClick={nextStep}>下一步</button>
        ) : (
          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? '生成中...' : '生成习惯节点'}
          </button>
        )}
      </div>
    </section>
  );
}

function parseFailurePathNodes(nodesJson: string): FailurePathNode[] {
  try {
    const parsed = JSON.parse(nodesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((node): node is FailurePathNode => {
      return typeof node?.id === 'string' && typeof node?.text === 'string';
    });
  } catch {
    return [];
  }
}

function FormulaDetailPanel({
  formula,
  workingId,
  editTitle,
  editDescription,
  editError,
  savingEdit,
  onSaveEdit,
  setEditTitle,
  setEditDescription,
  onReview,
  onAddChild,
  onActivate,
  onDeactivate,
}: {
  formula: RsipFormula | null;
  workingId: number | null;
  editTitle: string;
  editDescription: string;
  editError: string;
  savingEdit: boolean;
  onSaveEdit: (formula: RsipFormula) => void;
  setEditTitle: (value: string) => void;
  setEditDescription: (value: string) => void;
  onReview: (id: number) => void;
  onAddChild: (id: number) => void;
  onActivate: (id: number) => void;
  onDeactivate: (id: number) => void;
}) {
  if (!formula) {
    return (
      <section className="rsip-formula-detail-panel">
        <div className="rsip-detail-panel-header">
          <h3>节点详情</h3>
        </div>
        <div className="rsip-detail-panel-body">
          <div className="empty-state compact">
            <p className="empty-title">选择一个习惯节点</p>
            <p className="empty-desc">单击树上的节点后，可以在这里查看和编辑。</p>
          </div>
        </div>
      </section>
    );
  }

  const isWorking = workingId === formula.id;

  return (
    <section className="rsip-formula-detail-panel">
      <div className="rsip-detail-panel-header">
        <h3>节点详情</h3>
      </div>
      <div className="rsip-detail-panel-body">
        <div className="rsip-detail-node-status">
          <span className={`formula-status status-${formula.status}`}>
            {formula.status === 'active' ? '已点亮' : '未点亮'}
          </span>
          <span>习惯节点</span>
        </div>
        <div className="rsip-detail-edit">
          <label className="form-field">
            <span>习惯名称</span>
            <input
              value={editTitle}
              onChange={(event) => {
                setEditTitle(event.target.value);
              }}
            />
          </label>
          <label className="form-field">
            <span>执行说明</span>
            <textarea
              rows={4}
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              placeholder="写清触发条件、完成标准和例外边界"
            />
          </label>
          {editError && <p className="form-error" role="alert">{editError}</p>}
          <div className="rsip-detail-primary-actions">
            <button
              className="btn btn-primary"
              disabled={savingEdit || !editTitle.trim()}
              onClick={() => onSaveEdit(formula)}
            >
              {savingEdit ? '保存中...' : '保存节点'}
            </button>
            {formula.status === 'active' ? (
              <button
                className="btn btn-danger-outline"
                disabled={isWorking}
                onClick={() => onDeactivate(formula.id)}
              >
                熄灭
              </button>
            ) : (
              <button
                className="btn btn-secondary"
                disabled={isWorking}
                onClick={() => onActivate(formula.id)}
              >
                点亮
              </button>
            )}
          </div>
        </div>
        <div className="rsip-detail-secondary-actions">
          <button className="btn btn-secondary" onClick={() => onAddChild(formula.id)}>
            ＋ 添加子节点
          </button>
          <button className="btn btn-secondary" onClick={() => onReview(formula.id)}>
            查看复盘
          </button>
        </div>
      </div>
    </section>
  );
}

function FormulaTreeGraph({
  roots,
  selectedFormulaId,
  onSelect,
}: {
  roots: FormulaTreeNode[];
  selectedFormulaId: number | null;
  onSelect: (id: number) => void;
}) {
  const layout = useMemo(() => layoutForest(roots), [roots]);
  const itemsById = new Map(layout.map((item) => [item.node.id, item]));
  const selectedPath = selectedFormulaId ? findFormulaPath(roots, selectedFormulaId) : [];
  const selectedPathIds = new Set(selectedPath.map((node) => node.id));
  const content = useMemo(() => getContentBounds(layout), [layout]);
  const canvasWidth = Math.max(320, content.left + content.width + 96);
  const canvasHeight = Math.max(560, content.top + content.height + 96);

  return (
    <div className="formula-graph">
      <div className="formula-graph-toolbar">
        <span>整棵国策树 · {roots.length === 1 ? '单根纵向结构' : `${roots.length} 个根节点`}</span>
        <div className="formula-graph-legend" aria-label="节点状态图例">
          <span><i className="formula-graph-legend-dot active" />已点亮</span>
          <span><i className="formula-graph-legend-dot" />未点亮</span>
        </div>
      </div>
      <div className="formula-graph-viewport">
        <div
          className="formula-graph-canvas"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          <svg
            className="formula-graph-edges"
            width={canvasWidth}
            height={canvasHeight}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            aria-hidden="true"
          >
            {layout.map((item) => {
              if (item.parentId === null) return null;
              const parent = itemsById.get(item.parentId);
              if (!parent) return null;

              const startY = parent.y + parent.height / 2;
              const endY = item.y - item.height / 2;
              const middleY = startY + (endY - startY) * 0.5;
              const isSelectedEdge =
                selectedPathIds.has(parent.node.id) && selectedPathIds.has(item.node.id);
              const isActiveEdge =
                parent.node.status === 'active' && item.node.status === 'active';

              return (
                <path
                  key={`${parent.node.id}-${item.node.id}`}
                  className={`formula-graph-edge${isActiveEdge ? ' active' : ''}${isSelectedEdge ? ' selected' : ''}`}
                  d={`M ${parent.x} ${startY} C ${parent.x} ${middleY}, ${item.x} ${middleY}, ${item.x} ${endY}`}
                />
              );
            })}
          </svg>
          <div className="formula-graph-nodes" role="tree" aria-label="国策树习惯节点">
            {layout.map((item) => {
              const isSelected = selectedFormulaId === item.node.id;
              return (
                <button
                  key={item.node.id}
                  type="button"
                  className={`formula-graph-node${item.node.status === 'active' ? ' active' : ''}${item.depth === 0 ? ' root' : ''}${isSelected ? ' selected' : ''}`}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: item.width,
                    minHeight: item.height,
                  }}
                  role="treeitem"
                  aria-level={item.depth + 1}
                  aria-selected={isSelected}
                  aria-label={`${item.node.title}，${item.node.status === 'active' ? '已点亮' : '未点亮'}`}
                  title={item.node.title}
                  onClick={() => onSelect(item.node.id)}
                >
                  <span className="formula-graph-node-dot" aria-hidden="true" />
                  <span className="formula-graph-node-title">{item.node.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function getTreeDepth(nodes: FormulaTreeNode[]): number {
  if (nodes.length === 0) return 0;
  return Math.max(...nodes.map((node) => 1 + getTreeDepth(node.children)));
}
