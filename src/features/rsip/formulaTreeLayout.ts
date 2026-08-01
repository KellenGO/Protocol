import type { RsipFormula } from '../../types';

export interface FormulaTreeNode extends RsipFormula {
  children: FormulaTreeNode[];
}

export interface LayoutNode {
  node: FormulaTreeNode;
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

export function getFormulaNodeSize(depth: number): { width: number; height: number } {
  if (depth === 0) return { width: 164, height: 44 };
  if (depth === 1) return { width: 144, height: 40 };
  return { width: 130, height: 38 };
}

export function buildFormulaTree(formulas: RsipFormula[]): FormulaTreeNode[] {
  const map = new Map<number, FormulaTreeNode>();
  formulas.forEach((f) => map.set(f.id, { ...f, children: [] }));

  const roots: FormulaTreeNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (nodes: FormulaTreeNode[]) => {
    nodes.sort((a, b) => a.position - b.position || a.id - b.id);
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export function measureSubtree(node: FormulaTreeNode, depth: number): number {
  const nodeWidth = getFormulaNodeSize(depth).width;

  if (node.children.length === 0) {
    return nodeWidth;
  }

  const childrenWidth =
    node.children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0) +
    LAYOUT.SIBLING_GAP * (node.children.length - 1);

  return Math.max(nodeWidth, childrenWidth);
}

export function layoutForest(roots: FormulaTreeNode[]): LayoutNode[] {
  const items: LayoutNode[] = [];
  let rootLeft = LAYOUT.CANVAS_PADDING;

  const layoutNode = (
    node: FormulaTreeNode,
    left: number,
    depth: number,
    parentId: number | null,
  ): void => {
    const subtreeWidth = measureSubtree(node, depth);
    const size = getFormulaNodeSize(depth);
    const nodeX = left + subtreeWidth / 2;
    const nodeY = LAYOUT.CANVAS_PADDING + depth * LAYOUT.LEVEL_GAP;
    items.push({ node, depth, parentId, x: nodeX, y: nodeY, width: size.width, height: size.height });

    if (node.children.length > 0) {
      const childrenWidth =
        node.children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0) +
        LAYOUT.SIBLING_GAP * (node.children.length - 1);
      let childLeft = nodeX - childrenWidth / 2;
      for (const child of node.children) {
        layoutNode(child, childLeft, depth + 1, node.id);
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

export function collectSubtreeIds(node: FormulaTreeNode, ids: Set<number>): void {
  for (const child of node.children) {
    ids.add(child.id);
    collectSubtreeIds(child, ids);
  }
}

export function findFormulaNode(
  nodes: FormulaTreeNode[],
  id: number,
): FormulaTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findFormulaNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export function findFormulaPath(nodes: FormulaTreeNode[], id: number): FormulaTreeNode[] {
  for (const node of nodes) {
    if (node.id === id) return [node];
    const childPath = findFormulaPath(node.children, id);
    if (childPath.length > 0) return [node, ...childPath];
  }
  return [];
}
