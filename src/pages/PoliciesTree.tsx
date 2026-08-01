import { useCallback, useEffect, useRef, useState } from 'react';
import PolicyDetailPanel, { type PolicyToast } from '../features/policies/PolicyDetailPanel';
import { usePolicy } from '../features/policies/PolicyProvider';
import PolicyTreeCanvas from '../features/policies/PolicyTreeCanvas';

interface ActionFeedback {
  tone: 'success' | 'error';
  text: string;
}

interface PageToast extends PolicyToast {
  id: number;
}

/** 面板关闭动画时长（与 .policies-tree-detail-panel 的 transition 一致） */
const PANEL_CLOSE_MS = 250;
/** 详情面板操作 toast 停留时长（5-8s） */
const TOAST_DURATION_MS = 6500;

export default function PoliciesTree() {
  const {
    treeNodes,
    selectedNodeId,
    isDetailPanelOpen,
    toggleDetailPanel,
    reload,
    setSelectedNodeId,
    setIsDetailPanelOpen,
  } = usePolicy();

  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [toast, setToast] = useState<PageToast | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const selectedNode = treeNodes.find((n) => n.id === selectedNodeId);

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = window.setTimeout(() => setActionFeedback(null), 6000);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);

  useEffect(() => {
    if (!toast) return;
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, [toast]);

  // 面板重新打开或切换节点时清除"正在关闭"标记，避免面板停留在滑出位置
  useEffect(() => {
    if (isDetailPanelOpen && isClosing) setIsClosing(false);
  }, [isDetailPanelOpen, isClosing, selectedNodeId]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((t: PolicyToast) => {
    setToast({ ...t, id: Date.now() });
  }, []);

  const handleClosePanel = () => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsClosing(false);
      setIsDetailPanelOpen(false);
    }, PANEL_CLOSE_MS);
  };

  async function handleMoved(result: unknown) {
    await reload();
    const moved = treeNodes.find((n) => n.id === (result as { id?: number } | null)?.id);
    setActionFeedback({
      tone: 'success',
      text: moved ? `已移动「${moved.policy_name}」` : '已更新节点位置',
    });
  }

  return (
    <>
      <div className="policies-tree-layout">
        <div className="policies-tree-canvas-area">
          <PolicyTreeCanvas
            treeNodes={treeNodes}
            selectedNodeId={isDetailPanelOpen ? selectedNodeId : null}
            isDetailPanelOpen={isDetailPanelOpen}
            onSelect={(nodeId) => {
              if (nodeId === null) {
                setSelectedNodeId(null);
                setIsDetailPanelOpen(false);
              } else {
                toggleDetailPanel(nodeId);
              }
            }}
            onMoved={handleMoved}
            onError={(msg) => console.error(msg)}
          />
        </div>

        {isDetailPanelOpen && selectedNode && (
          <div className={`policies-tree-detail-panel${isClosing ? ' closing' : ''}`}>
            <PolicyDetailPanel
              key={selectedNode.id}
              node={selectedNode}
              onClose={handleClosePanel}
              onReload={reload}
              onShowToast={showToast}
            />
          </div>
        )}

        {actionFeedback && (
          <div
            className={`rsip-feedback-toast ${actionFeedback.tone}`}
            role="status"
            aria-live="polite"
          >
            <div className="rsip-feedback-toast-marker" />
            <p>{actionFeedback.text}</p>
            <button
              type="button"
              className="rsip-feedback-toast-close"
              aria-label="关闭提示"
              onClick={() => setActionFeedback(null)}
            >
              ×
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="policy-toast" role="status" aria-live="polite">
          <div className="policy-toast-marker" />
          <div className="policy-toast-content">
            <p>{toast.text}</p>
            {toast.actions && toast.actions.length > 0 && (
              <div className="policy-toast-actions">
                {toast.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="policy-toast-action"
                    onClick={action.onClick}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
