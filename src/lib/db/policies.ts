import { invoke } from '@tauri-apps/api/core';
import type {
  Policy,
  PolicyCycle,
  PolicyEvent,
  PolicyTreeNode,
  PolicyWithTreeStatus,
  TreeNodeWithPolicy,
} from '../../types';

export async function createPolicy(params: {
  name: string;
  description: string;
}): Promise<Policy> {
  return invoke('create_policy', {
    name: params.name,
    description: params.description,
  });
}

export async function getPolicies(): Promise<Policy[]> {
  return invoke('get_policies');
}

export async function updatePolicy(
  id: number,
  params: { name: string; description: string },
): Promise<Policy> {
  return invoke('update_policy', {
    id,
    name: params.name,
    description: params.description,
  });
}

export async function addPolicyToTree(params: {
  policyId: number;
  parentNodeId?: number | null;
  siblingOrder?: number | null;
}): Promise<PolicyTreeNode> {
  return invoke('add_policy_to_tree', {
    policyId: params.policyId,
    parentNodeId: params.parentNodeId ?? null,
    siblingOrder: params.siblingOrder ?? null,
  });
}

export interface RemoveFromTreeResult {
  removed_node_ids: number[];
  affected_policy_ids: number[];
}

export async function removePolicyFromTree(nodeId: number): Promise<RemoveFromTreeResult> {
  return invoke('remove_policy_from_tree', { nodeId });
}

export async function reparentTreeNode(params: {
  nodeId: number;
  newParentNodeId?: number | null;
  newSiblingOrder?: number | null;
}): Promise<PolicyTreeNode> {
  return invoke('reparent_tree_node', {
    nodeId: params.nodeId,
    newParentNodeId: params.newParentNodeId ?? null,
    newSiblingOrder: params.newSiblingOrder ?? null,
  });
}

export async function reorderTreeNode(params: {
  nodeId: number;
  newSiblingOrder?: number | null;
}): Promise<PolicyTreeNode> {
  return invoke('reorder_tree_node', {
    nodeId: params.nodeId,
    newSiblingOrder: params.newSiblingOrder ?? null,
  });
}

export interface LightPolicyResult {
  cycle: PolicyCycle;
}

export async function lightPolicy(nodeId: number): Promise<LightPolicyResult> {
  return invoke('light_policy', { nodeId });
}

export async function extinguishPolicy(
  nodeId: number,
  reason?: string,
): Promise<LightPolicyResult> {
  return invoke('extinguish_policy', { nodeId, reason: reason ?? null });
}

export interface PermanentlyDeletePolicyResult {
  deleted_policy_id: number;
  removed_tree_node_ids: number[];
  affected_child_policy_ids: number[];
}

export async function permanentlyDeletePolicy(
  policyId: number,
): Promise<PermanentlyDeletePolicyResult> {
  return invoke('permanently_delete_policy', { policyId });
}

export interface PolicyTree {
  nodes: TreeNodeWithPolicy[];
  cycles: PolicyCycle[];
}

export async function getPolicyTree(): Promise<PolicyTree> {
  return invoke('get_policy_tree');
}

export async function getPolicyLibrary(inTree?: boolean | null): Promise<PolicyWithTreeStatus[]> {
  return invoke('get_policy_library', { inTree: inTree ?? null });
}

export async function getPolicyEvents(policyId: number, limit = 20): Promise<PolicyEvent[]> {
  return invoke('get_policy_events', { policyId, limit });
}

export async function getPolicyCycles(policyId: number): Promise<PolicyCycle[]> {
  return invoke('get_policy_cycles', { policyId });
}

export async function undoRemoveFromTree(
  removedNodeIds: number[],
  affectedPolicyIds: number[],
): Promise<void> {
  return invoke('undo_remove_from_tree', {
    removedNodeIds,
    affectedPolicyIds,
  });
}

export async function undoReparent(
  nodeId: number,
  oldParentNodeId: number | null,
  oldSiblingOrder: number,
): Promise<void> {
  return invoke('undo_reparent', {
    nodeId,
    oldParentNodeId,
    oldSiblingOrder,
  });
}

export async function undoExtinguish(nodeId: number): Promise<void> {
  return invoke('undo_extinguish', { nodeId });
}
