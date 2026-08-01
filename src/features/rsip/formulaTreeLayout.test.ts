import {
  buildFormulaTree,
  findFormulaNode,
  getContentBounds,
  getFormulaNodeSize,
  layoutForest,
  measureSubtree,
  nodeRect,
  rectanglesOverlap,
  type LayoutNode,
} from './formulaTreeLayout.ts';
import type { RsipFormula } from '../../types/index.ts';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertNoOverlaps(items: LayoutNode[], message: string) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (rectanglesOverlap(nodeRect(items[i]), nodeRect(items[j]))) {
        throw new Error(`${message}: node ${items[i].node.id} overlaps node ${items[j].node.id}`);
      }
    }
  }
}

function makeFormula(partial: Partial<RsipFormula> & { id: number; title: string }): RsipFormula {
  return {
    parent_id: null,
    description: '',
    status: 'inactive',
    position: 0,
    created_at: '2026-08-01 00:00:00',
    updated_at: '2026-08-01 00:00:00',
    activated_at: null,
    deactivated_at: null,
    goal_id: null,
    failure_path_id: null,
    intervention_node_id: null,
    dependency_note: null,
    ...partial,
  };
}

function forest(rows: Array<{ id: number; parentId: number | null; position: number }>) {
  const formulas = rows.map((row) =>
    makeFormula({ id: row.id, title: `n${row.id}`, parent_id: row.parentId, position: row.position }),
  );
  return buildFormulaTree(formulas);
}

// 5 个无子节点根节点不重叠
{
  const roots = forest([
    { id: 1, parentId: null, position: 0 },
    { id: 2, parentId: null, position: 1 },
    { id: 3, parentId: null, position: 2 },
    { id: 4, parentId: null, position: 3 },
    { id: 5, parentId: null, position: 4 },
  ]);
  assertEqual(roots.length, 5, 'five roots built');
  assertNoOverlaps(layoutForest(roots), '5 leaf roots');
}

// 30 个根节点不重叠
{
  const roots = forest(
    Array.from({ length: 30 }, (_, i) => ({ id: i + 1, parentId: null, position: i })),
  );
  assertNoOverlaps(layoutForest(roots), '30 leaf roots');
}

// 多层、不对称子树不重叠
{
  const roots = forest([
    { id: 1, parentId: null, position: 0 },
    { id: 2, parentId: 1, position: 0 },
    { id: 3, parentId: 1, position: 1 },
    { id: 4, parentId: 3, position: 0 },
    { id: 5, parentId: 3, position: 1 },
    { id: 6, parentId: 3, position: 2 },
    { id: 7, parentId: 6, position: 0 },
    { id: 8, parentId: 6, position: 1 },
    { id: 9, parentId: 6, position: 2 },
    { id: 10, parentId: 6, position: 3 },
    { id: 11, parentId: null, position: 1 },
    { id: 12, parentId: 11, position: 0 },
  ]);
  assertNoOverlaps(layoutForest(roots), 'asymmetric multi-level tree');
}

// 父节点位于子节点区域中央（所有非叶节点的 x 等于其子树整体中心）
{
  const roots = forest([
    { id: 1, parentId: null, position: 0 },
    { id: 2, parentId: 1, position: 0 },
    { id: 3, parentId: 1, position: 1 },
    { id: 4, parentId: 3, position: 0 },
  ]);
  const items = layoutForest(roots);
  const one = items.find((i) => i.node.id === 1)!;
  const two = items.find((i) => i.node.id === 2)!;
  const three = items.find((i) => i.node.id === 3)!;
  const four = items.find((i) => i.node.id === 4)!;
  const childrenBlockCenter = (two.x + four.x) / 2;
  assertEqual(one.x, childrenBlockCenter, 'parent is centered over its children');
  assertEqual(three.x, four.x, 'single-child parent is centered over its child');
}

// 相同数据多次布局坐标一致
{
  const roots = forest([
    { id: 1, parentId: null, position: 0 },
    { id: 2, parentId: 1, position: 0 },
    { id: 3, parentId: null, position: 1 },
  ]);
  const first = JSON.stringify(layoutForest(roots));
  const second = JSON.stringify(layoutForest(roots));
  assertEqual(first, second, 'layout is deterministic');
}

// 新增子节点后出现在父节点下一层
{
  const roots = forest([{ id: 1, parentId: null, position: 0 }]);
  const before = layoutForest(roots);
  const parentY = before[0].y;
  const withChild = forest([
    { id: 1, parentId: null, position: 0 },
    { id: 2, parentId: 1, position: 0 },
  ]);
  const after = layoutForest(withChild);
  const child = after.find((i) => i.node.id === 2)!;
  assertEqual(child.depth, 1, 'new child depth is 1');
  assertEqual(child.y, parentY + 112, 'new child is one LEVEL_GAP below its parent');
  assertEqual(after.find((i) => i.node.id === 1)!.x, child.x, 'parent stays centered over its only child');
}

// 所有节点都包含在内容包围盒内
{
  const roots = forest([
    { id: 1, parentId: null, position: 0 },
    { id: 2, parentId: 1, position: 0 },
    { id: 3, parentId: 1, position: 1 },
    { id: 4, parentId: null, position: 1 },
  ]);
  const items = layoutForest(roots);
  const bounds = getContentBounds(items);
  for (const item of items) {
    const r = nodeRect(item);
    if (r.left < bounds.left || r.top < bounds.top || r.left + r.width > bounds.left + bounds.width || r.top + r.height > bounds.top + bounds.height) {
      throw new Error(`node ${item.node.id} escapes content bounds`);
    }
  }
}

// measureSubtree / getFormulaNodeSize / findFormulaNode 冒烟
{
  const roots = forest([{ id: 1, parentId: null, position: 0 }]);
  assertEqual(measureSubtree(roots[0], 0), 164, 'leaf root subtree width equals ROOT_WIDTH');
  assertEqual(getFormulaNodeSize(0).width, 164, 'root width');
  assertEqual(getFormulaNodeSize(1).width, 144, 'level one width');
  assertEqual(getFormulaNodeSize(2).width, 130, 'deep node width');
  const found = findFormulaNode(roots, 1);
  assertEqual(found !== null, true, 'findFormulaNode finds existing node');
  assertEqual(findFormulaNode(roots, 999) === null, true, 'findFormulaNode returns null for missing node');
}

console.log('formulaTreeLayout tests passed');
