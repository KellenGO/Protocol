import { useEffect, useRef, useState } from 'react';
import {
  extinguishPolicy,
  getPolicyCycles,
  lightPolicy,
  removePolicyFromTree,
  undoExtinguish,
  undoRemoveFromTree,
  updatePolicy,
  type RemoveFromTreeResult,
} from '../../lib/db/policies';
import type { PolicyCycle, TreeNodeWithPolicy } from '../../types';

export interface PolicyToastAction {
  label: string;
  onClick: () => void;
}

export interface PolicyToast {
  text: string;
  actions?: PolicyToastAction[];
}

interface Props {
  node: TreeNodeWithPolicy;
  onClose: () => void;
  onReload: () => Promise<void>;
  /**
   * 可选：把操作 toast 交给页面渲染。从树移除后面板会关闭，
   * 若 toast 由面板自身渲染会在卸载时消失，因此需要页面持有。
   */
  onShowToast?: (toast: PolicyToast) => void;
}

/** 撤销/补充原因提示的停留时长（5-8s） */
const UNDO_WINDOW_MS = 6500;

/** 已点亮天数：从本轮开始时间算起，点亮当天计为第 1 天 */
function daysLit(startedAt: string): number {
  const start = new Date(startedAt + 'Z').getTime();
  return Math.floor((Date.now() - start) / 86_400_000) + 1;
}

/** 格式化本轮点亮时间，如 "2026-08-01 14:30" */
function formatDateTime(raw: string): string {
  const d = new Date(raw + 'Z');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PolicyDetailPanel({ node, onClose, onReload, onShowToast }: Props) {
  const [name, setName] = useState(node.policy_name);
  const [description, setDescription] = useState(node.policy_description);
  const [currentCycle, setCurrentCycle] = useState<PolicyCycle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');
  const undoTimerRef = useRef<number | null>(null);

  // 加载本轮（未结束的）执行周期；状态变化（点亮/熄灭/撤销）后重新拉取
  useEffect(() => {
    let cancelled = false;
    getPolicyCycles(node.policy_id)
      .then((cycles) => {
        if (cancelled) return;
        setCurrentCycle(
          cycles.find((c) => c.tree_node_id === node.id && c.ended_at === null) ?? null,
        );
      })
      .catch(() => {
        if (!cancelled) setCurrentCycle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [node.id, node.policy_id, node.status]);

  // 卸载时清理撤销窗口计时器
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  const notify = (toast: PolicyToast) => {
    onShowToast?.(toast);
  };

  /** 统一包装异步操作：防重复点击、错误提示 */
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLight = () =>
    run(async () => {
      await lightPolicy(node.id);
      await onReload();
    });

  const handleExtinguish = () =>
    run(async () => {
      await extinguishPolicy(node.id);
      await onReload();
      // 熄灭后提供 5-8s 的撤销窗口（面板按钮与 toast 均可触发）
      setUndoAvailable(true);
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => setUndoAvailable(false), UNDO_WINDOW_MS);
      notify({
        text: `「${node.policy_name}」已熄灭`,
        actions: [
          { label: '撤销', onClick: () => void handleUndo() },
          { label: '补充原因', onClick: () => setReasonOpen(true) },
        ],
      });
    });

  const handleUndo = () =>
    run(async () => {
      await undoExtinguish(node.id);
      await onReload();
      setUndoAvailable(false);
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      notify({ text: '已撤销熄灭' });
    });

  const saveReason = () =>
    run(async () => {
      const reason = reasonDraft.trim();
      if (!reason) {
        setReasonOpen(false);
        setReasonDraft('');
        return;
      }
      await extinguishPolicy(node.id, reason);
      await onReload();
      setReasonOpen(false);
      setReasonDraft('');
      notify({ text: '已补充熄灭原因' });
    });

  const undoRemoval = async (result: RemoveFromTreeResult) => {
    try {
      await undoRemoveFromTree(result.removed_node_ids, result.affected_policy_ids);
      await onReload();
      notify({ text: '已撤销从树移除' });
    } catch (err) {
      notify({ text: `撤销失败：${String(err)}` });
    }
  };

  const handleRemove = () =>
    run(async () => {
      const result = await removePolicyFromTree(node.id);
      await onReload();
      onClose();
      notify({
        text: `「${node.policy_name}」已从国策树移除`,
        actions: [{ label: '撤销', onClick: () => void undoRemoval(result) }],
      });
    });

  const handleSave = () =>
    run(async () => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        setError('国策名称不能为空');
        return;
      }
      await updatePolicy(node.policy_id, {
        name: trimmedName,
        description: description.trim(),
      });
      await onReload();
      notify({ text: '已保存' });
    });

  return (
    <>
      <div className="policy-detail-header">
        <input
          className="policy-detail-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="国策名称"
          aria-label="国策名称"
        />
        <button
          type="button"
          className="policy-detail-close"
          onClick={onClose}
          aria-label="关闭详情面板"
        >
          ×
        </button>
      </div>

      <div className="policy-detail-body">
        <div className="policy-detail-status-row">
          {node.status === 'lit' ? (
            <span className="status-badge status-active">
              {currentCycle ? `已点亮 ${daysLit(currentCycle.started_at)} 天` : '已点亮'}
            </span>
          ) : (
            <span className="status-badge status-neutral">已熄灭</span>
          )}
        </div>

        {error && (
          <p className="action-error" role="alert">
            {error}
          </p>
        )}

        {reasonOpen && (
          <div className="policy-reason-input">
            <input
              autoFocus
              value={reasonDraft}
              onChange={(e) => setReasonDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveReason();
              }}
              placeholder="补充熄灭原因（可选）"
              aria-label="补充熄灭原因"
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void saveReason()}
              disabled={busy}
            >
              保存
            </button>
          </div>
        )}

        <div className="form-field">
          <span>执行说明</span>
          <textarea
            className="policy-detail-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="写下这条国策的执行说明……"
          />
        </div>

        <div className="policy-detail-time">
          <span>本轮点亮时间</span>
          <strong>{currentCycle ? formatDateTime(currentCycle.started_at) : '—'}</strong>
        </div>

        <div className="policy-detail-actions">
          {node.status === 'lit' ? (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => void handleExtinguish()}
              disabled={busy}
            >
              熄灭
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleLight()}
              disabled={busy}
            >
              重新点亮
            </button>
          )}
          {undoAvailable && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleUndo()}
              disabled={busy}
            >
              撤销
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void handleRemove()}
            disabled={busy}
          >
            从国策树移除
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            保存
          </button>
        </div>
      </div>
    </>
  );
}
