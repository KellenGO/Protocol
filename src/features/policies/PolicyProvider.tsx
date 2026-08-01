import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { PolicyCycle, PolicyEvent, PolicyWithTreeStatus, TreeNodeWithPolicy } from '../../types';
import { getPolicyLibrary, getPolicyTree, getPolicyEvents, getPolicyCycles } from '../../lib/db/policies';

interface PolicyContextValue {
  policies: PolicyWithTreeStatus[];
  treeNodes: TreeNodeWithPolicy[];
  /** 按 policy_id 聚合的历史事件（后端倒序返回），供复盘使用 */
  eventsByPolicyId: Record<number, PolicyEvent[]>;
  /** 按 policy_id 聚合的执行周期，供复盘使用 */
  cyclesByPolicyId: Record<number, PolicyCycle[]>;
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
  const [policies, setPolicies] = useState<PolicyWithTreeStatus[]>([]);
  const [treeNodes, setTreeNodes] = useState<TreeNodeWithPolicy[]>([]);
  const [eventsByPolicyId, setEventsByPolicyId] = useState<Record<number, PolicyEvent[]>>({});
  const [cyclesByPolicyId, setCyclesByPolicyId] = useState<Record<number, PolicyCycle[]>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tree, library] = await Promise.all([getPolicyTree(), getPolicyLibrary()]);
      const details = await Promise.all(
        tree.nodes.map(async (node) => {
          const [events, cycles] = await Promise.all([
            getPolicyEvents(node.policy_id, 100),
            getPolicyCycles(node.policy_id),
          ]);
          return { policyId: node.policy_id, events, cycles };
        }),
      );
      const nextEvents: Record<number, PolicyEvent[]> = {};
      const nextCycles: Record<number, PolicyCycle[]> = {};
      for (const detail of details) {
        nextEvents[detail.policyId] = detail.events;
        nextCycles[detail.policyId] = detail.cycles;
      }
      setTreeNodes(tree.nodes);
      setPolicies(library);
      setEventsByPolicyId(nextEvents);
      setCyclesByPolicyId(nextCycles);
      setError('');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
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
        eventsByPolicyId,
        cyclesByPolicyId,
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
