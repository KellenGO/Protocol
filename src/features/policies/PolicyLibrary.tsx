import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  addPolicyToTree,
  createPolicy,
  permanentlyDeletePolicy,
  removePolicyFromTree,
  updatePolicy,
} from '../../lib/db/policies';
import type { PolicyWithTreeStatus } from '../../types';
import { buildPolicyTree, type PolicyTreeNode } from './treeLayout';
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
  const [parentNodeId, setParentNodeId] = useState<number | null | undefined>(undefined);

  // 永久删除确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<PolicyWithTreeStatus | null>(null);

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<PolicyWithTreeStatus | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  /** 完整国策树（递归），用于父节点选择器 */
  const fullTree = useMemo(() => buildPolicyTree(treeNodes), [treeNodes]);

  /** 收集某节点→根的路径面包屑 */
  function breadcrumb(rootNodes: PolicyTreeNode[], targetNodeId: number): string {
    function walk(nodes: PolicyTreeNode[], path: string[]): string | null {
      for (const n of nodes) {
        const next = [...path, n.node.policy_name];
        if (n.node.id === targetNodeId) return next.join(' / ');
        const found = walk(n.children, next);
        if (found) return found;
      }
      return null;
    }
    return walk(rootNodes, []) ?? '';
  }

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
    if (!addTarget || parentNodeId === undefined) return;
    setBusy(true);
    setActionError('');
    try {
      await addPolicyToTree({ policyId: addTarget.id, parentNodeId: parentNodeId });
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

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editTarget || !editName.trim()) return;
    setBusy(true);
    setActionError('');
    try {
      await updatePolicy(editTarget.id, { name: editName.trim(), description: editDesc.trim() });
      await reload();
      setEditTarget(null);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(target: PolicyWithTreeStatus) {
    setDeleteTarget(target);
  }

  async function confirmDelete() {
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
                <button
                  type="button"
                  className="btn btn-ghost compact-btn"
                  disabled={busy}
                  onClick={() => {
                    setEditTarget(p);
                    setEditName(p.name);
                    setEditDesc(p.description);
                    setActionError('');
                  }}
                >
                  编辑
                </button>
                {!p.in_tree && (
                  <button
                    type="button"
                    className="btn btn-secondary compact-btn"
                    disabled={busy}
                    onClick={() => {
                      setAddTarget(p);
                      setParentNodeId(undefined);
                      setActionError('');
                    }}
                  >
                    加入国策树
                  </button>
                )}
                {p.in_tree && (
                  <button
                    type="button"
                    className="btn btn-ghost compact-btn"
                    disabled={busy}
                    onClick={() => handleRemoveFromTree(p)}
                  >
                    从树移除
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger-outline compact-btn"
                  disabled={busy}
                  onClick={() => handleDelete(p)}
                >
                  永久删除
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {addTarget && (
        <AddToTreeModal
          target={addTarget}
          roots={fullTree}
          breadcrumb={(id) => breadcrumb(fullTree, id)}
          busy={busy}
          onCancel={() => { setAddTarget(null); setParentNodeId(undefined); }}
          onConfirm={() => handleAddToTree()}
          parentNodeId={parentNodeId}
          setParentNodeId={setParentNodeId}
        />
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
                onClick={confirmDelete}
                disabled={busy}
              >
                永久删除
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="policy-modal-overlay" onClick={() => !busy && setEditTarget(null)}>
          <form
            className="policy-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`编辑「${editTarget.name}」`}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleUpdate}
          >
            <h3>编辑「{editTarget.name}」</h3>
            <div className="form-field">
              <span>名称</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-field">
              <span>执行说明</span>
              <textarea
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
            </div>
            <div className="policy-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditTarget(null)}
                disabled={busy}
              >
                取消
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !editName.trim()}>
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ============================================================
// AddToTreeModal — 递归树选择器
// ============================================================

function AddToTreeModal({
  target,
  roots,
  breadcrumb,
  busy,
  onCancel,
  onConfirm,
  parentNodeId,
  setParentNodeId,
}: {
  target: PolicyWithTreeStatus;
  roots: PolicyTreeNode[];
  breadcrumb: (nodeId: number) => string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  parentNodeId: number | null | undefined;
  setParentNodeId: (id: number | null) => void;
}) {
  const [treeSearch, setTreeSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    // 初始展开所有根节点
    return new Set(roots.map((r) => r.node.id));
  });

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /** 自动展开搜索匹配节点的祖先路径 */
  const autoExpandForSearch = useCallback((keyword: string) => {
    if (!keyword) return;
    const kw = keyword.toLowerCase();
    const toExpand = new Set(expandedIds);

    function walk(nodes: PolicyTreeNode[], ancestorIds: number[]) {
      for (const n of nodes) {
        if (subtreeMatches(n, kw)) {
          ancestorIds.forEach((aid) => toExpand.add(aid));
          toExpand.add(n.node.id);
        }
        walk(n.children, [...ancestorIds, n.node.id]);
      }
    }
    walk(roots, []);
    setExpandedIds(toExpand);
  }, [roots, expandedIds]);

  const selectedPath = parentNodeId != null ? breadcrumb(parentNodeId) : null;
  const notYetChosen = parentNodeId === undefined;

  return (
    <div className="policy-modal-overlay" onClick={() => !busy && onCancel()}>
      <div
        className="policy-modal policy-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={`加入「${target.name}」到国策树`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>选择父国策</h3>
        <p className="policy-modal-subtitle">
          {notYetChosen
            ? '请选择一个父国策，或选"作为新的根节点"'
            : parentNodeId === null
              ? `「${target.name}」将作为新的根节点加入`
              : `「${target.name}」将成为「${selectedPath}」的子国策`}
        </p>

        <input
          type="search"
          className="policy-library-search"
          placeholder="搜索国策名称…"
          value={treeSearch}
          onChange={(e) => {
            setTreeSearch(e.target.value);
            autoExpandForSearch(e.target.value.trim().toLowerCase());
          }}
          aria-label="在国策树中搜索"
        />

        <div className="policy-tree-selector">
          {/* 根节点选项始终第一 */}
          <label className={`policy-tree-option${parentNodeId === null ? ' selected' : ''}`}>
            <input
              type="radio"
              name="parentNode"
              checked={parentNodeId === null}
              onChange={() => setParentNodeId(null)}
            />
            <span className="policy-tree-option-label">作为新的根节点</span>
          </label>

          {/* 递归树 */}
          {roots.length === 0 && (
            <p className="policy-modal-hint">国策树为空，只能作为根节点加入。</p>
          )}
          {roots.map((root) => (
            <TreeSelectorNode
              key={root.node.id}
              node={root}
              depth={0}
              selectedId={parentNodeId ?? null}
              onSelect={(id) => setParentNodeId(id)}
              expandedIds={expandedIds}
              onToggleExpand={toggleExpand}
              searchKeyword={treeSearch.trim().toLowerCase()}
            />
          ))}
        </div>

        <div className="policy-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy || notYetChosen}>
            加入并点亮
          </button>
        </div>
      </div>
    </div>
  );
}

function TreeSelectorNode({
  node,
  depth,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpand,
  searchKeyword,
}: {
  node: PolicyTreeNode;
  depth: number;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  expandedIds: Set<number>;
  onToggleExpand: (id: number) => void;
  searchKeyword: string;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.node.id);
  const isSelected = selectedId === node.node.id;

  // 有搜索词时：本节点或子树匹配才渲染
  if (searchKeyword) {
    const selfMatch = node.node.policy_name.toLowerCase().includes(searchKeyword);
    const childMatch = node.children.some((c) => subtreeMatches(c, searchKeyword));
    if (!selfMatch && !childMatch) return null;
  }

  return (
    <div className="policy-tree-branch">
      <label
        className={`policy-tree-option${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: 16 + depth * 20 }}
      >
        {hasChildren && (
          <button
            type="button"
            className="policy-tree-expand"
            aria-label={isExpanded ? '收起' : '展开'}
            onClick={(e) => { e.preventDefault(); onToggleExpand(node.node.id); }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        {!hasChildren && <span className="policy-tree-expand policy-tree-expand-spacer" />}
        <input
          type="radio"
          name="parentNode"
          checked={isSelected}
          onChange={() => onSelect(node.node.id)}
        />
        <span className="policy-tree-option-label">{node.node.policy_name}</span>
      </label>
      {hasChildren && isExpanded && (
        <div className="policy-tree-children">
          {node.children.map((child) => (
            <TreeSelectorNode
              key={child.node.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              searchKeyword={searchKeyword}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function subtreeMatches(node: PolicyTreeNode, keyword: string): boolean {
  if (node.node.policy_name.toLowerCase().includes(keyword)) return true;
  return node.children.some((c) => subtreeMatches(c, keyword));
}
