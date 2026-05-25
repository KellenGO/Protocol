import { useEffect, useMemo, useState } from 'react';
import {
  activateRsipFormula,
  createRsipFormula,
  deactivateRsipFormula,
  getFormulaEvents,
  getRsipFormulas,
} from '../lib/db';
import type { FormulaEvent, RsipFormula } from '../types';

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

function eventLabel(type: FormulaEvent['event_type']): string {
  if (type === 'created') return '加入定式树';
  if (type === 'activated') return '点亮';
  if (type === 'deactivated') return '熄灭';
  return '递归回滚';
}

function formatDateTime(raw: string): string {
  return new Date(raw + 'Z').toLocaleString('zh-CN');
}

export default function RSIP() {
  const [formulas, setFormulas] = useState<RsipFormula[]>([]);
  const [events, setEvents] = useState<FormulaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState<number | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  const tree = useMemo(() => buildTree(formulas), [formulas]);
  const activeCount = formulas.filter((f) => f.status === 'active').length;

  async function reload() {
    const [nextFormulas, nextEvents] = await Promise.all([
      getRsipFormulas(),
      getFormulaEvents(12),
    ]);
    setFormulas(nextFormulas);
    setEvents(nextEvents);
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
      await deactivateRsipFormula(id, '用户裁定该定式当前熄灭');
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setWorkingId(null);
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
                        {eventLabel(event.event_type)}
                      </span>
                      <span className="formula-event-title">{event.formula_title}</span>
                    </div>
                    <span className="formula-event-time">{formatDateTime(event.created_at)}</span>
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
