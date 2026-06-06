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
} from '../lib/db';
import { formatProtocolDateTime, formulaEventLabel } from '../lib/protocolEvents';
import type { FailurePathNode, FormulaEvent, RsipFailurePath, RsipFormula, RsipGoal } from '../types';

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

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  const tree = useMemo(() => buildTree(formulas), [formulas]);
  const activeCount = formulas.filter((f) => f.status === 'active').length;
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
      await deactivateRsipFormula(id);
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setWorkingId(null);
    }
  }

  async function handleViewGoal(goalId: number) {
    setSelectedGoalId(goalId);
    setViewMode('goals');
    setError('');
    try {
      setGoalPaths(await getFailurePaths(goalId));
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleArchiveGoal(goalId: number) {
    setArchivingGoalId(goalId);
    setError('');
    try {
      await archiveRsipGoal(goalId);
      if (selectedGoalId === goalId) {
        setSelectedGoalId(null);
        setGoalPaths([]);
      }
      await reload();
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

      <div className="rsip-header-actions">
        <div className="rsip-view-toggle" role="tablist" aria-label="RSIP view">
          <button
            type="button"
            className={viewMode === 'tree' ? 'active' : ''}
            onClick={() => setViewMode('tree')}
            role="tab"
            aria-selected={viewMode === 'tree'}
          >
            定式树
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
        <button className="btn btn-secondary" onClick={() => setViewMode('goals')}>
          查看目标
        </button>
        <button className="btn btn-primary" onClick={() => setWizardOpen(true)}>
          新建目标转译
        </button>
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
        <div className="stat-card">
          <span className="stat-label">Goals</span>
          <span className="stat-value">{goals.length}</span>
        </div>
      </div>

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
      <div className="rsip-layout">
        <section className="rsip-tree-panel">
          <div className="section-header">
            <h3>定式树</h3>
            <span className="section-hint">每天最多新增一个定式更符合 RSIP 原意</span>
          </div>
          {loading ? (
            <p className="placeholder-text" role="status" aria-live="polite">加载中…</p>
          ) : tree.length === 0 ? (
            <div className="empty-state compact" aria-live="polite">
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
                  onActivate={handleActivate}
                  onDeactivate={handleDeactivate}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="rsip-side-panel">
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

            {formError && <p className="form-error" role="alert">{formError}</p>}

            <button className="btn btn-primary" disabled={creating} onClick={handleCreate}>
              {creating ? '创建中…' : '写入定式树'}
            </button>
          </section>

          <section className="rsip-events-card">
            <h3>最近 RSIP 事件</h3>
            {events.length === 0 ? (
              <p className="placeholder-text" aria-live="polite">暂无定式事件</p>
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
          <span className="section-hint">目标是方向，定式才是协议</span>
        </div>
        {goals.length === 0 ? (
          <div className="empty-state compact" aria-live="polite">
            <p className="empty-title">还没有目标</p>
            <p className="empty-desc">先把一个宏观方向转译成失败路径和低阻力定式。</p>
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
                  <span>{goal.formula_count} 定式</span>
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
          <p className="placeholder-text">选择一个目标，查看它下面的失败路径和并列定式树。</p>
        ) : (
          <>
            <div className="section-header">
              <h3>{selectedGoal.title}</h3>
              <span className="section-hint">一个目标可以拥有多棵根定式树</span>
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
              <span>关联定式</span>
              {selectedGoalFormulas.length === 0 ? (
                <p className="placeholder-text">还没有从该目标生成定式。</p>
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
      setError('定式标题不能为空。');
      return;
    }
    if (parentId && !dependencyNote.trim()) {
      setError('选择父定式时，需要说明它为什么依赖父定式。');
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
          <span className="section-hint">目标是方向，定式才是协议。</span>
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
                  placeholder="目标不会直接执行，Protocol 会把它转译成可执行定式。"
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
            <span>定式标题</span>
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
            <span>是否作为已有定式的子定式</span>
            <select value={parentFormulaId} onChange={(event) => setParentFormulaId(event.target.value)}>
              <option value="">作为并列根定式</option>
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
                placeholder="如果父定式失败，这个子定式是否大概率也无法稳定执行？请写明依赖理由。"
              />
            </label>
          )}
          <p className="dependency-guidance">
            子定式不是相关规则，而是依赖规则。不依赖父定式的规则，更适合作为同一目标下的并列根定式。
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
            {saving ? '生成中...' : '生成定式'}
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

function FormulaTreeNode({
  node,
  depth,
  workingId,
  onAddChild,
  onActivate,
  onDeactivate,
}: {
  node: FormulaNode;
  depth: number;
  workingId: number | null;
  onAddChild: (id: number) => void;
  onActivate: (id: number) => void;
  onDeactivate: (id: number) => void;
}) {
  const navigate = useNavigate();
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
          <button
            className="btn btn-secondary"
            onClick={() => navigate(`/rsip-review?formula=${node.id}`)}
          >
            复盘
          </button>
          <button className="btn btn-secondary" onClick={() => onAddChild(node.id)} aria-label={`为定式 ${node.title} 添加子定式`}>
            加子定式
          </button>
          {node.status === 'active' ? (
            <button
              className="btn-danger-outline compact-btn"
              disabled={isWorking}
              onClick={() => onDeactivate(node.id)}
              aria-label={`熄灭定式：${node.title}`}
            >
              熄灭
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={isWorking}
              onClick={() => onActivate(node.id)}
              aria-label={`点亮定式：${node.title}`}
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
          onActivate={onActivate}
          onDeactivate={onDeactivate}
        />
      ))}
    </div>
  );
}

function countActive(nodes: FormulaNode[]): number {
  return nodes.reduce((sum, node) => {
    return sum + (node.status === 'active' ? 1 : 0) + countActive(node.children);
  }, 0);
}
