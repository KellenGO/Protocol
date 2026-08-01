import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  addPolicyToTree,
  createPolicy,
  permanentlyDeletePolicy,
  removePolicyFromTree,
} from '../../lib/db/policies';
import type { PolicyWithTreeStatus } from '../../types';
import { usePolicy } from './PolicyProvider';

type LibraryFilter = 'all' | 'inTree' | 'notInTree' | 'lit' | 'extinguished';

const FILTER_OPTIONS: { value: LibraryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'inTree', label: '已加入国策树' },
  { value: 'notInTree', label: '未加入国策树' },
  { value: 'lit', label: '已点亮' },
  { value: 'extinguished', label: '已熄灭' },
];

/** 截断至 30 字 */
function truncate(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function PolicyLibrary() {
  const { policies, treeNodes, reload, error } = usePolicy();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');

  // 内联新建表单
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [createError, setCreateError] = useState('');

  // 加入国策树弹窗
  const [addTarget, setAddTarget] = useState<PolicyWithTreeStatus | null>(null);
  const [parentNodeId, setParentNodeId] = useState<number | null>(null);

  // 永久删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<PolicyWithTreeStatus | null>(null);

  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  /** 树中已点亮节点，作为「作为子节点」的可选父节点 */
  const litNodes = useMemo(() => treeNodes.filter((n) => n.status === 'lit'), [treeNodes]);

  const visiblePolicies = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return policies.filter((p) => {
      if (keyword && !p.name.toLowerCase().includes(keyword)) return false;
      switch (filter) {
        case 'inTree':
          return p.in_tree;
        case 'notInTree':
          return !p.in_tree;
        case 'lit':
          return p.in_tree && p.tree_status === 'lit';
        case 'extinguished':
          return p.in_tree && p.tree_status === 'extinguished';
        default:
          return true;
      }
    });
  }, [policies, search, filter]);

  // Esc 关闭弹窗
  useEffect(() => {
    if (!addTarget && !deleteTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddTarget(null);
        setDeleteTarget(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addTarget, deleteTarget]);

  function statusOf(p: PolicyWithTreeStatus): { key: string; label: string } {
    if (!p.in_tree) return { key: 'out', label: '未加入' };
    if (p.tree_status === 'lit') return { key: 'lit', label: '已点亮' };
    return { key: 'extinguished', label: '已熄灭' };
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setCreateError('请输入名称');
      return;
    }
    setBusy(true);
    setCreateError('');
    try {
      await createPolicy({ name, description: newDesc.trim() });
      await reload();
      setNewName('');
      setNewDesc('');
      setIsCreating(false);
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddToTree() {
    if (!addTarget) return;
    setBusy(true);
    setActionError('');
    try {
      await addPolicyToTree({ policyId: addTarget.id, parentNodeId });
      await reload();
      setAddTarget(null);
      setParentNodeId(null);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFromTree(policy: PolicyWithTreeStatus) {
    const node = treeNodes.find((n) => n.policy_id === policy.id);
    if (!node) {
      setActionError('未找到对应的树节点，请刷新后重试');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await removePolicyFromTree(node.id);
      await reload();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setActionError('');
    try {
      await permanentlyDeletePolicy(deleteTarget.id);
      await reload();
      setDeleteTarget(null);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="policy-library">
      {error && (
        <p className="action-error" role="alert">
          {error}
        </p>
      )}
      {actionError && (
        <p className="action-error" role="alert">
          {actionError}
        </p>
      )}

      <div className="policy-library-toolbar">
        <input
          type="search"
          className="policy-library-search"
          placeholder="搜索国策…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="搜索国策"
        />
        <select
          className="form-select filter-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value as LibraryFilter)}
          aria-label="筛选国策"
        >
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setIsCreating((v) => !v);
            setCreateError('');
          }}
        >
          {isCreating ? '收起' : '+ 新建国策'}
        </button>
      </div>

      {isCreating && (
        <form className="policy-library-create" onSubmit={handleCreate}>
          <div className="form-field">
            <span>名称</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="国策名称"
              autoFocus
            />
          </div>
          <div className="form-field">
            <span>执行说明</span>
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="怎么算做到（可选）"
            />
          </div>
          {createError && <p className="form-error">{createError}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              创建
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setIsCreating(false)}
              disabled={busy}
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="policy-library-list">
        {visiblePolicies.length === 0 && (
          <div className="empty-state compact">
            <div className="empty-title">没有匹配的国策</div>
            <p className="empty-desc">调整搜索或筛选条件，或新建一项国策。</p>
          </div>
        )}
        {visiblePolicies.map((p) => {
          const st = statusOf(p);
          return (
            <div key={p.id} className="policy-library-row">
              <span className={`policy-library-status ${st.key}`}>{st.label}</span>
              <div className="policy-library-main">
                <span className="policy-library-name">{p.name}</span>
                {p.description && (
                  <span className="policy-library-desc">· {truncate(p.description)}</span>
                )}
              </div>
              <div className="policy-library-actions">
                {!p.in_tree && (
                  <button
                    type="button"
                    className="btn btn-secondary compact-btn"
                    disabled={busy}
                    onClick={() => {
                      setAddTarget(p);
                      setParentNodeId(null);
                      setActionError('');
                    }}
                  >
                    加入国策树
                  </button>
                )}
                {p.in_tree && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost compact-btn"
                      disabled={busy}
                      onClick={() => handleRemoveFromTree(p)}
                    >
                      从树移除
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-outline compact-btn"
                      disabled={busy}
                      onClick={() => {
                        setDeleteTarget(p);
                        setActionError('');
                      }}
                    >
                      永久删除
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {addTarget && (
        <div className="policy-modal-overlay" onClick={() => !busy && setAddTarget(null)}>
          <div
            className="policy-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`加入「${addTarget.name}」到国策树`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>加入「{addTarget.name}」到国策树</h3>
            <div className="policy-modal-options">
              <label className="policy-modal-option">
                <input
                  type="radio"
                  name="parentNode"
                  checked={parentNodeId === null}
                  onChange={() => setParentNodeId(null)}
                />
                <span>作为根节点</span>
              </label>
              {litNodes.map((node) => (
                <label key={node.id} className="policy-modal-option">
                  <input
                    type="radio"
                    name="parentNode"
                    checked={parentNodeId === node.id}
                    onChange={() => setParentNodeId(node.id)}
                  />
                  <span>作为「{node.policy_name}」的子节点</span>
                </label>
              ))}
            </div>
            {litNodes.length === 0 && (
              <p className="policy-modal-hint">树中暂无已点亮节点，只能作为根节点加入。</p>
            )}
            <div className="policy-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setAddTarget(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddToTree}
                disabled={busy}
              >
                加入并点亮
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="policy-modal-overlay" onClick={() => !busy && setDeleteTarget(null)}>
          <div
            className="policy-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`永久删除「${deleteTarget.name}」`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>永久删除「{deleteTarget.name}」？</h3>
            <div className="policy-modal-body">
              <p>该操作将：</p>
              <ul>
                <li>永久删除这项国策及其历史记录</li>
                <li>将它和它的子树从国策树中移除</li>
                <li>子国策仍保留在国策库</li>
                <li>此操作无法撤销</li>
              </ul>
            </div>
            <div className="policy-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={busy}
              >
                永久删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
