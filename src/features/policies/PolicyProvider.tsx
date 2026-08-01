import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

// 这些类型后面 Track A 会正式定义，现在先用占位 unknown
type Policy = unknown;
type TreeNodeWithPolicy = unknown;

interface PolicyContextValue {
  policies: Policy[];
  treeNodes: TreeNodeWithPolicy[];
  selectedNodeId: number | null;
  isDetailPanelOpen: boolean;
  loading: boolean;
  error: string;
  setSelectedNodeId: (id: number | null) => void;
  setIsDetailPanelOpen: (open: boolean) => void;
  toggleDetailPanel: (nodeId: number) => void;
  reload: () => Promise<void>;
}

const PolicyContext = createContext<PolicyContextValue | null>(null);

export function PolicyProvider({ children }: { children: ReactNode }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [treeNodes, setTreeNodes] = useState<TreeNodeWithPolicy[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    // TODO: 替换为真实 API 调用
    setPolicies([]);
    setTreeNodes([]);
    setLoading(false);
  }, []);

  const toggleDetailPanel = useCallback((nodeId: number) => {
    setSelectedNodeId((prev) => {
      if (prev === nodeId) {
        // 再次单击同一节点 → 切换面板
        setIsDetailPanelOpen((open) => !open);
        return nodeId;
      }
      // 不同节点 → 打开面板
      setIsDetailPanelOpen(true);
      return nodeId;
    });
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(String(err)));
  }, [reload]);

  return (
    <PolicyContext.Provider
      value={{
        policies,
        treeNodes,
        selectedNodeId,
        isDetailPanelOpen,
        loading,
        error,
        setSelectedNodeId,
        setIsDetailPanelOpen,
        toggleDetailPanel,
        reload,
      }}
    >
      {children}
    </PolicyContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePolicy() {
  const ctx = useContext(PolicyContext);
  if (!ctx) throw new Error('usePolicy must be used within PolicyProvider');
  return ctx;
}
