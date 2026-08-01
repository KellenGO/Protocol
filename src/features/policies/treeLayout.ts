import type { TreeNodeWithPolicy } from '../../types';

/** 树节点包装：node 为数据库行，children 为其子节点 */
export interface PolicyTreeNode {
  node: TreeNodeWithPolicy;
  children: PolicyTreeNode[];
}

export interface LayoutNode {
  node: PolicyTreeNode;
  depth: number;
  parentId: number | null;
  /** 节点中心 x（世界坐标） */
  x: number;
  /** 节点中心 y（世界坐标） */
  y: number;
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const LAYOUT = {
  ROOT_WIDTH: 164,
  LEVEL_ONE_WIDTH: 144,
  DEEP_NODE_WIDTH: 130,
  SIBLING_GAP: 36,
  ROOT_GAP: 72,
  LEVEL_GAP: 112,
  CANVAS_PADDING: 96,
} as const;

export function getPolicyNodeSize(depth: number): { width: number; height: number } {
  if (depth === 0) return { width: 164, height: 44 };
  if (depth === 1) return { width: 144, height: 40 };
  return { width: 130, height: 38 };
}

export function buildPolicyTree(nodes: TreeNodeWithPolicy[]): PolicyTreeNode[] {
  const map = new Map<number, PolicyTreeNode>();
  nodes.forEach((n) => map.set(n.id, { node: n, children: [] }));

  const roots: PolicyTreeNode[] = [];
  map.forEach((treeNode) => {
    const parentId = treeNode.node.parent_node_id;
    if (parentId !== null && map.has(parentId)) {
      map.get(parentId)!.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  });

  const sortNodes = (treeNodes: PolicyTreeNode[]) => {
    treeNodes.sort(
      (a, b) => a.node.sibling_order - b.node.sibling_order || a.node.id - b.node.id,
    );
    treeNodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export function measureSubtree(node: PolicyTreeNode, depth: number): number {
  const nodeWidth = getPolicyNodeSize(depth).width;

  if (node.children.length === 0) {
    return nodeWidth;
  }

  const childrenWidth =
    node.children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0) +
    LAYOUT.SIBLING_GAP * (node.children.length - 1);

  return Math.max(nodeWidth, childrenWidth);
}

export function layoutForest(roots: PolicyTreeNode[]): LayoutNode[] {
  const items: LayoutNode[] = [];
  let rootLeft = LAYOUT.CANVAS_PADDING;

  const layoutNode = (
    node: PolicyTreeNode,
    left: number,
    depth: number,
    parentId: number | null,
  ): void => {
    const subtreeWidth = measureSubtree(node, depth);
    const size = getPolicyNodeSize(depth);
    const nodeX = left + subtreeWidth / 2;
    const nodeY = LAYOUT.CANVAS_PADDING + depth * LAYOUT.LEVEL_GAP;
    items.push({ node, depth, parentId, x: nodeX, y: nodeY, width: size.width, height: size.height });

    if (node.children.length > 0) {
      const childrenWidth =
        node.children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0) +
        LAYOUT.SIBLING_GAP * (node.children.length - 1);
      let childLeft = nodeX - childrenWidth / 2;
      for (const child of node.children) {
        layoutNode(child, childLeft, depth + 1, node.node.id);
        childLeft += measureSubtree(child, depth + 1) + LAYOUT.SIBLING_GAP;
      }
    }
  };

  for (const root of roots) {
    layoutNode(root, rootLeft, 0, null);
    rootLeft += measureSubtree(root, 0) + LAYOUT.ROOT_GAP;
  }

  return items;
}

export function nodeRect(item: LayoutNode): Rect {
  return {
    left: item.x - item.width / 2,
    top: item.y - item.height / 2,
    width: item.width,
    height: item.height,
  };
}

export function getContentBounds(items: LayoutNode[]): Rect {
  if (items.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    left = Math.min(left, item.x - item.width / 2);
    top = Math.min(top, item.y - item.height / 2);
    right = Math.max(right, item.x + item.width / 2);
    bottom = Math.max(bottom, item.y + item.height / 2);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export function rectanglesOverlap(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

export function collectSubtreeIds(node: PolicyTreeNode, ids: Set<number>): void {
  for (const child of node.children) {
    ids.add(child.node.id);
    collectSubtreeIds(child, ids);
  }
}

export function findPolicyNode(
  nodes: PolicyTreeNode[],
  id: number,
): PolicyTreeNode | null {
  for (const node of nodes) {
    if (node.node.id === id) return node;
    const found = findPolicyNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export function findPolicyPath(nodes: PolicyTreeNode[], id: number): PolicyTreeNode[] {
  for (const node of nodes) {
    if (node.node.id === id) return [node];
    const childPath = findPolicyPath(node.children, id);
    if (childPath.length > 0) return [node, ...childPath];
  }
  return [];
}
