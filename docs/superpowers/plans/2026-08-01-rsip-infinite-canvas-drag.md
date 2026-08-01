# 国策树无限画布与节点拖拽改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 RSIP 国策树从"按视口压缩的滚动画布"改造为"先测子树再放置的自动布局 + 无限画布缩放平移 + 节点拖拽改父级"，并新增后端 `move_rsip_formula` 事务命令与 `reparented` 事件迁移。

**Architecture:** 布局与几何全部抽成纯函数（`formulaTreeLayout.ts` / `formulaTreeGeometry.ts`），可被 Node 直接测试；画布组件 `FormulaTreeCanvas.tsx` 管理 transform 状态（pan/scale）与 Pointer Events 交互，节点坐标始终由布局函数算出、不落库；后端新增独立 `move_rsip_formula` 命令，整个移动在单个 SQLite 事务内完成（校验 → 整理 position → 更新 → 递归熄灭 → 事件），`formula_events` 表通过"重建表 + 复制数据"迁移加入 `reparented` 类型。

**Tech Stack:** React 19 + TypeScript（Vite 构建，Node 24 原生跑 TS 测试）、原生 SVG 连线 + HTML 节点、Tauri 2 + rusqlite 0.31（bundled）、现有 CSS 变量体系。**不引入任何新依赖**。

## Global Constraints

- 保留工作区现有未提交/已暂存改动（`git status` 中列出的文件）；禁止 `git reset`、`git checkout --`、整文件覆盖；只做增量编辑。
- 禁止新增依赖（尤其 React Flow）；不引入 HTML5 Drag and Drop，一律使用 Pointer Events。
- 数据库只存 `parent_id` + `position`，绝不把 x/y 坐标写入数据库。
- 不把移动事件伪装成 `created`；`reparented` 必须先迁移表约束再写入。
- 不在每次新增/拖动后强制重置用户视角；仅首次加载时执行一次"适应画布"，新节点越界时只做最小平移。
- 节点排序始终为 `position` 升序、相同则按 `id`。
- 节点宽度常量：根 164 / 一级 144 / 深层 130；间距 SIBLING_GAP=36、ROOT_GAP=72、LEVEL_GAP=112、CANVAS_PADDING=96；缩放范围 0.3–2.4；拖动阈值 6px。
- 用缩小节点或压缩间距掩盖碰撞 → 禁止；布局必须保证任意两节点矩形不重叠。
- UI 文案保持中文、与现有提示风格一致。
- 最终验证：`npm run check`、`npm run build`、`cd src-tauri && cargo test`。

---

### Task 1: 修复根节点/选中节点状态灯颜色

**Files:**
- Modify: `src/styles/global.css:2540-2543`（删除覆盖状态灯的两条规则）

**Interfaces:**
- Consumes: 无
- Produces: 状态灯颜色只由 `.formula-graph-node.active` 决定（灰=未点亮，绿=点亮），`root`/`selected` 不再改灯色

- [ ] **Step 1: 删除覆盖状态灯颜色的规则**

当前 [global.css:2540-2543](src/styles/global.css#L2540-L2543) 内容：

```css
.formula-graph-node.root .formula-graph-node-dot,
.formula-graph-node.selected .formula-graph-node-dot {
  background: var(--gold);
}
```

整块删除（连带删除其后空行，保留 `.formula-graph-node-title` 规则）。删除后状态灯只剩：

```css
.formula-graph-node-dot {
  width: 7px;
  height: 7px;
  background: var(--text-muted);   /* 未点亮：灰 */
  border-radius: 50%;
}

.formula-graph-node.active .formula-graph-node-dot {
  background: var(--success);      /* 点亮：绿 */
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: PASS（CSS 不影响 tsc；同时确认没有其他文件引用被删规则）

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "修复：root/selected 样式不再覆盖状态灯颜色"
```

---

### Task 2: 抽出纯函数森林布局 + 无重叠测试

**Files:**
- Create: `src/features/rsip/formulaTreeLayout.ts`
- Create: `src/features/rsip/formulaTreeLayout.test.ts`
- Modify: `package.json`（`test` 脚本追加新测试文件）

**Interfaces:**
- Consumes: `RsipFormula`（来自 `src/types`，仅类型引用）
- Produces:
  - `interface FormulaTreeNode extends RsipFormula { children: FormulaTreeNode[] }`
  - `interface LayoutNode { node: FormulaTreeNode; depth: number; parentId: number | null; x: number; y: number; width: number; height: number }`（x/y 为节点**中心**坐标，与 `.formula-graph-node` 的 `translate(-50%,-50%)` 一致）
  - `interface Rect { left: number; top: number; width: number; height: number }`
  - `export const LAYOUT = { ROOT_WIDTH: 164, LEVEL_ONE_WIDTH: 144, DEEP_NODE_WIDTH: 130, SIBLING_GAP: 36, ROOT_GAP: 72, LEVEL_GAP: 112, CANVAS_PADDING: 96 } as const`
  - `getFormulaNodeSize(depth): { width; height }`（44/40/38，复用现有高度）
  - `buildFormulaTree(formulas: RsipFormula[]): FormulaTreeNode[]`
  - `measureSubtree(node, depth): number`
  - `layoutForest(roots): LayoutNode[]`
  - `nodeRect(item: LayoutNode): Rect`
  - `getContentBounds(items: LayoutNode[]): Rect`
  - `rectanglesOverlap(a: Rect, b: Rect): boolean`
  - `collectSubtreeIds(node, ids: Set<number>): void`
  - `findFormulaNode(nodes, id): FormulaTreeNode | null`
  - `findFormulaPath(nodes, id): FormulaTreeNode[]`

- [ ] **Step 1: 写失败测试**

创建 `src/features/rsip/formulaTreeLayout.test.ts`（Node 原生跑 TS，import 必须带 `.ts` 后缀；断言风格照抄 `src/pages/dashboardViewModel.test.ts`）：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node src/features/rsip/formulaTreeLayout.test.ts`
Expected: FAIL，`Cannot find module './formulaTreeLayout.ts'` 或类似导入错误

- [ ] **Step 3: 写最小实现 `formulaTreeLayout.ts`**

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node src/features/rsip/formulaTreeLayout.test.ts`
Expected: PASS，输出 `formulaTreeLayout tests passed`

- [ ] **Step 5: 更新 `package.json` 的 test 脚本**

`"test": "node src/pages/dashboardViewModel.test.ts && node src/features/rsip/formulaTreeLayout.test.ts"`

Run: `npm test`
Expected: 全部断言通过

- [ ] **Step 6: Commit**

```bash
git add src/features/rsip/formulaTreeLayout.ts src/features/rsip/formulaTreeLayout.test.ts package.json
git commit -m "布局重构：先测子树宽度再放置节点的森林布局与无重叠测试"
```

---

### Task 3: 用新布局替换旧 `buildFormulaGraphLayout`

**Files:**
- Modify: `src/pages/RSIP.tsx`（删除 `buildFormulaGraphLayout`、`getFormulaGraphNodeDimensions`、`countFormulaLeaves`、本地 `buildTree`/`FormulaNode`/`findFormulaPath`；`FormulaTreeGraph` 改用 `layoutForest`，去掉对 `viewportWidth` 的依赖）

**Interfaces:**
- Consumes: Task 2 的 `buildFormulaTree`、`FormulaTreeNode`、`layoutForest`、`LayoutNode`、`getContentBounds`、`nodeRect`、`getFormulaNodeSize`、`findFormulaPath`
- Produces: `RSIP.tsx` 中 `const tree = useMemo(() => buildFormulaTree(formulas), [formulas])`；`FormulaTreeGraph` 的 props 不变（`roots: FormulaTreeNode[]`）

- [ ] **Step 1: 替换 imports 与 `buildTree` 调用**

`src/pages/RSIP.tsx`：

```tsx
import {
  buildFormulaTree,
  findFormulaPath,
  getContentBounds,
  layoutForest,
  type FormulaTreeNode,
  type LayoutNode,
} from '../features/rsip/formulaTreeLayout';
```

删除文件底部的本地 `interface FormulaNode`、`buildTree`、`findFormulaPath`、`buildFormulaGraphLayout`、`getFormulaGraphNodeDimensions`、`countFormulaLeaves` 及 `FormulaGraphItem`/`FormulaGraphLayout` 两个 interface。

将 `const tree = useMemo(() => buildTree(formulas), [formulas]);` 改为：

```tsx
const tree = useMemo(() => buildFormulaTree(formulas), [formulas]);
```

- [ ] **Step 2: 重写 `FormulaTreeGraph` 内部布局计算**

删除 `viewportRef`/`viewportWidth`/ResizeObserver 相关的状态与 effect（新布局不需要视口宽度）。替换为：

```tsx
function FormulaTreeGraph({
  roots,
  selectedFormulaId,
  onSelect,
}: {
  roots: FormulaTreeNode[];
  selectedFormulaId: number | null;
  onSelect: (id: number) => void;
}) {
  const layout = useMemo(() => layoutForest(roots), [roots]);
  const itemsById = new Map(layout.map((item) => [item.node.id, item]));
  const selectedPath = selectedFormulaId ? findFormulaPath(roots, selectedFormulaId) : [];
  const selectedPathIds = new Set(selectedPath.map((node) => node.id));
  const content = useMemo(() => getContentBounds(layout), [layout]);
  const canvasWidth = Math.max(320, content.left + content.width + 96);
  const canvasHeight = Math.max(560, content.top + content.height + 96);

  return (
    <div className="formula-graph">
      <div className="formula-graph-toolbar">
        <span>整棵国策树 · {roots.length === 1 ? '单根纵向结构' : `${roots.length} 个根节点`}</span>
        <div className="formula-graph-legend" aria-label="节点状态图例">
          <span><i className="formula-graph-legend-dot active" />已点亮</span>
          <span><i className="formula-graph-legend-dot" />未点亮</span>
        </div>
      </div>
      <div className="formula-graph-viewport">
        <div
          className="formula-graph-canvas"
          style={{ width: canvasWidth, height: canvasHeight }}
        >
          <svg
            className="formula-graph-edges"
            width={canvasWidth}
            height={canvasHeight}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            aria-hidden="true"
          >
            {layout.map((item) => {
              if (item.parentId === null) return null;
              const parent = itemsById.get(item.parentId);
              if (!parent) return null;

              const startY = parent.y + parent.height / 2;
              const endY = item.y - item.height / 2;
              const middleY = startY + (endY - startY) * 0.5;
              const isSelectedEdge =
                selectedPathIds.has(parent.node.id) && selectedPathIds.has(item.node.id);
              const isActiveEdge =
                parent.node.status === 'active' && item.node.status === 'active';

              return (
                <path
                  key={`${parent.node.id}-${item.node.id}`}
                  className={`formula-graph-edge${isActiveEdge ? ' active' : ''}${isSelectedEdge ? ' selected' : ''}`}
                  d={`M ${parent.x} ${startY} C ${parent.x} ${middleY}, ${item.x} ${middleY}, ${item.x} ${endY}`}
                />
              );
            })}
          </svg>
          <div className="formula-graph-nodes" role="tree" aria-label="国策树习惯节点">
            {layout.map((item) => {
              const isSelected = selectedFormulaId === item.node.id;
              return (
                <button
                  key={item.node.id}
                  type="button"
                  className={`formula-graph-node${item.node.status === 'active' ? ' active' : ''}${item.depth === 0 ? ' root' : ''}${isSelected ? ' selected' : ''}`}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: item.width,
                    minHeight: item.height,
                  }}
                  role="treeitem"
                  aria-level={item.depth + 1}
                  aria-selected={isSelected}
                  aria-label={`${item.node.title}，${item.node.status === 'active' ? '已点亮' : '未点亮'}`}
                  title={item.node.title}
                  onClick={() => onSelect(item.node.id)}
                >
                  <span className="formula-graph-node-dot" aria-hidden="true" />
                  <span className="formula-graph-node-title">{item.node.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
```

节点位置语义不变（`left/top` 为中心坐标 + CSS `translate(-50%,-50%)`），连线算法不变，只换了布局来源。`nodeRect`/`getFormulaNodeSize` 若此处未用到可不 import（Task 4 的组件会用到）。

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run lint`
Expected: PASS（无未使用变量、无类型错误）

Run: `npm run dev`（或 `npm run build`），手工确认：树按新间距渲染、滚动查看、多根节点不再重叠。

- [ ] **Step 4: Commit**

```bash
git add src/pages/RSIP.tsx
git commit -m "布局接入：RSIP 图改用子树测量布局，不再按视口压缩间距"
```

---

### Task 4: 无限画布结构 + 平移 + 滚轮缩放 + 几何纯函数

**Files:**
- Create: `src/features/rsip/formulaTreeGeometry.ts`
- Create: `src/features/rsip/formulaTreeGeometry.test.ts`
- Create: `src/features/rsip/FormulaTreeCanvas.tsx`（本任务先实现结构 + 平移 + 缩放 + 定位逻辑的骨架）
- Modify: `src/pages/RSIP.tsx`（用 `FormulaTreeCanvas` 替换 `FormulaTreeGraph`）
- Modify: `src/styles/global.css`（viewport/world/controls 样式，删除旧 canvas 样式）
- Modify: `package.json`（test 脚本追加几何测试）

**Interfaces:**
- Consumes: Task 2 的布局函数；`MoveRsipFormulaResult` 类型（Task 6 才用到，本任务不 import）
- Produces:
  - `export interface CanvasTransform { panX: number; panY: number; scale: number }`
  - `export const MIN_SCALE = 0.3; export const MAX_SCALE = 2.4;`
  - `clampScale(scale): number`
  - `screenToWorld(screenX, screenY, rect: { left; top }, transform): { x; y }`
  - `worldToScreen(worldX, worldY, rect, transform): { x; y }`
  - `zoomAtCursor(transform, cursorX, cursorY, deltaY): CanvasTransform`（鼠标锚点世界坐标不变）
  - `fitTransform(content: Rect, viewportWidth, viewportHeight, padding = 64): CanvasTransform`
  - `isPointInsideExpandedRect(point: { x; y }, nodeRect: Rect, padding = 14): boolean`
  - `FormulaTreeCanvas` 组件（props 见 Step 5）

- [ ] **Step 1: 写失败测试 `formulaTreeGeometry.test.ts`**

```ts
import {
  fitTransform,
  isPointInsideExpandedRect,
  screenToWorld,
  worldToScreen,
  zoomAtCursor,
  clampScale,
  MIN_SCALE,
  MAX_SCALE,
  type CanvasTransform,
} from './formulaTreeGeometry.ts';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertClose(actual: number, expected: number, message: string, epsilon = 1e-9) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

const rect = { left: 50, top: 30 };
const transform: CanvasTransform = { panX: 120, panY: 80, scale: 1.5 };

// worldToScreen(screenToWorld(point)) 还原原坐标
{
  const screen = { x: 200, y: 140 };
  const world = screenToWorld(screen.x, screen.y, rect, transform);
  const back = worldToScreen(world.x, world.y, rect, transform);
  assertClose(back.x, screen.x, 'roundtrip x');
  assertClose(back.y, screen.y, 'roundtrip y');
}

// 缩放前后鼠标锚点对应的世界坐标不变
{
  const cursor = { x: 300, y: 220 };
  const before = screenToWorld(cursor.x, cursor.y, rect, transform);
  const zoomed = zoomAtCursor(transform, cursor.x, cursor.y, 120);
  const after = screenToWorld(cursor.x, cursor.y, rect, zoomed);
  assertClose(after.x, before.x, 'anchor world x stable');
  assertClose(after.y, before.y, 'anchor world y stable');
  assertEqual(zoomed.scale > transform.scale, true, 'positive deltaY zooms in');
}

// 边界限制
{
  assertEqual(clampScale(0.1), MIN_SCALE, 'clamps to MIN_SCALE');
  assertEqual(clampScale(9), MAX_SCALE, 'clamps to MAX_SCALE');
  const zoomedOut = zoomAtCursor(transform, 100, 100, 1e9);
  assertEqual(zoomedOut.scale, MIN_SCALE, 'wheel zoom out clamps at MIN_SCALE');
  const zoomedIn = zoomAtCursor(transform, 100, 100, -1e9);
  assertEqual(zoomedIn.scale, MAX_SCALE, 'wheel zoom in clamps at MAX_SCALE');
}

// fitTransform 与缩放范围
{
  const content = { left: 96, top: 96, width: 1000, height: 500 };
  const fitted = fitTransform(content, 900, 600);
  const worldLeft = screenToWorld(0, 0, { left: 0, top: 0 }, fitted);
  const worldRight = screenToWorld(900, 0, { left: 0, top: 0 }, fitted);
  assertEqual(worldLeft.x <= content.left + 1, true, 'fit keeps content visible on the left');
  assertEqual(worldRight.x >= content.left + content.width - 1, true, 'fit keeps content visible on the right');
  assertEqual(fitted.scale >= MIN_SCALE && fitted.scale <= 1.2 + 1e-9, true, 'fit scale within [MIN_SCALE, 1.2]');
}

// isPointInsideExpandedRect
{
  const r = { left: 100, top: 100, width: 50, height: 50 };
  assertEqual(isPointInsideExpandedRect({ x: 100, y: 100 }, r), true, 'center point inside');
  assertEqual(isPointInsideExpandedRect({ x: 200, y: 200 }, r), false, 'far point outside');
  assertEqual(isPointInsideExpandedRect({ x: 125, y: 90 }, r), true, 'point inside padding region');
  assertEqual(isPointInsideExpandedRect({ x: 125, y: 80 }, r), false, 'point beyond padding');
}

console.log('formulaTreeGeometry tests passed');
```

- [ ] **Step 2: 运行确认失败**

Run: `node src/features/rsip/formulaTreeGeometry.test.ts`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 写实现 `formulaTreeGeometry.ts`**

```ts
import type { Rect } from './formulaTreeLayout';

export interface CanvasTransform {
  panX: number;
  panY: number;
  scale: number;
}

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2.4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  rect: { left: number; top: number },
  transform: CanvasTransform,
): { x: number; y: number } {
  return {
    x: (screenX - rect.left - transform.panX) / transform.scale,
    y: (screenY - rect.top - transform.panY) / transform.scale,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  rect: { left: number; top: number },
  transform: CanvasTransform,
): { x: number; y: number } {
  return {
    x: rect.left + transform.panX + worldX * transform.scale,
    y: rect.top + transform.panY + worldY * transform.scale,
  };
}

/** 以 cursor 为锚点缩放，缩放前后 cursor 处的世界坐标不变 */
export function zoomAtCursor(
  transform: CanvasTransform,
  cursorX: number,
  cursorY: number,
  deltaY: number,
): CanvasTransform {
  const nextScale = clampScale(transform.scale * Math.exp(-deltaY * 0.0015));
  if (nextScale === transform.scale) return transform;
  const worldX = (cursorX - transform.panX) / transform.scale;
  const worldY = (cursorY - transform.panY) / transform.scale;
  return {
    panX: cursorX - worldX * nextScale,
    panY: cursorY - worldY * nextScale,
    scale: nextScale,
  };
}

/** 把内容包围盒整体居中到视口，上限 1.2，下限 MIN_SCALE */
export function fitTransform(
  content: Rect,
  viewportWidth: number,
  viewportHeight: number,
  padding = 64,
): CanvasTransform {
  if (content.width === 0 || content.height === 0) {
    return { panX: 0, panY: 0, scale: 1 };
  }
  const scale = clampScale(
    Math.min(
      (viewportWidth - padding * 2) / content.width,
      (viewportHeight - padding * 2) / content.height,
      1.2,
    ),
  );
  const panX = (viewportWidth - content.width * scale) / 2 - content.left * scale;
  const panY = (viewportHeight - content.height * scale) / 2 - content.top * scale;
  return { panX, panY, scale };
}

export function isPointInsideExpandedRect(
  point: { x: number; y: number },
  nodeRect: Rect,
  padding = 14,
): boolean {
  return (
    point.x >= nodeRect.left - padding &&
    point.x <= nodeRect.left + nodeRect.width + padding &&
    point.y >= nodeRect.top - padding &&
    point.y <= nodeRect.top + nodeRect.height + padding
  );
}
```

- [ ] **Step 4: 运行几何测试确认通过**

Run: `node src/features/rsip/formulaTreeGeometry.test.ts`
Expected: PASS

更新 `package.json`：

```json
"test": "node src/pages/dashboardViewModel.test.ts && node src/features/rsip/formulaTreeLayout.test.ts && node src/features/rsip/formulaTreeGeometry.test.ts"
```

Run: `npm test` → PASS

- [ ] **Step 5: 创建 `FormulaTreeCanvas.tsx`（本任务范围：结构 + 平移 + 滚轮缩放 + 首次适应 + 定位骨架）**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findFormulaPath,
  getContentBounds,
  layoutForest,
  type FormulaTreeNode,
  type LayoutNode,
} from './formulaTreeLayout';
import {
  fitTransform,
  screenToWorld,
  zoomAtCursor,
  type CanvasTransform,
} from './formulaTreeGeometry';

type InteractionState =
  | { type: 'idle' }
  | {
      type: 'pending-node-drag';
      nodeId: number;
      pointerId: number;
      startX: number;
      startY: number;
    }
  | {
      type: 'dragging-node';
      nodeId: number;
      pointerId: number;
      targetParentId: number | null;
    }
  | {
      type: 'panning';
      pointerId: number;
      startX: number;
      startY: number;
      initialPanX: number;
      initialPanY: number;
    };

export default function FormulaTreeCanvas({
  roots,
  selectedFormulaId,
  highlightId,
  onSelect,
  onError,
}: {
  roots: FormulaTreeNode[];
  selectedFormulaId: number | null;
  highlightId: number | null;
  onSelect: (id: number) => void;
  onError: (message: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const wheelRequestRef = useRef<{ cursorX: number; cursorY: number; deltaY: number } | null>(null);
  const didFitRef = useRef(false);
  const lastHandledHighlightRef = useRef<number | null>(null);

  const [transform, setTransform] = useState<CanvasTransform>({ panX: 0, panY: 0, scale: 1 });
  const [interaction, setInteraction] = useState<InteractionState>({ type: 'idle' });

  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const layout = useMemo(() => layoutForest(roots), [roots]);
  const itemsById = useMemo(
    () => new Map(layout.map((item) => [item.node.id, item])),
    [layout],
  );
  const contentBounds = useMemo(() => getContentBounds(layout), [layout]);
  const selectedPath = useMemo(
    () => (selectedFormulaId ? findFormulaPath(roots, selectedFormulaId) : []),
    [roots, selectedFormulaId],
  );
  const selectedPathIds = useMemo(
    () => new Set(selectedPath.map((node) => node.id)),
    [selectedPath],
  );

  // 首次加载数据后执行一次适应画布
  useEffect(() => {
    if (roots.length === 0 || didFitRef.current) return;
    didFitRef.current = true;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setTransform(fitTransform(contentBounds, rect.width, rect.height));
  }, [roots, contentBounds]);

  // 滚轮缩放（React 的 onWheel 是 passive 监听，无法 preventDefault，必须用原生监听）
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      wheelRequestRef.current = {
        cursorX: event.clientX - rect.left,
        cursorY: event.clientY - rect.top,
        deltaY: event.deltaY,
      };
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const wheel = wheelRequestRef.current;
          wheelRequestRef.current = null;
          if (wheel) {
            setTransform((t) => zoomAtCursor(t, wheel.cursorX, wheel.cursorY, wheel.deltaY));
          }
        });
      }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  // 高亮/定位请求：只平移到可见（保持缩放），并闪烁 1 秒
  useEffect(() => {
    if (highlightId === null || highlightId === lastHandledHighlightRef.current) return;
    lastHandledHighlightRef.current = highlightId;
    const item = layout.find((i) => i.node.id === highlightId);
    if (!item) return;
    revealNode(item);
  }, [highlightId, layout]);

  function revealNode(item: LayoutNode) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const margin = 40;
    setTransform((t) => {
      const sx = t.panX + item.x * t.scale;
      const sy = t.panY + item.y * t.scale;
      let panX = t.panX;
      let panY = t.panY;
      if (sx < margin) panX += margin - sx;
      else if (sx > rect.width - margin) panX += rect.width - margin - sx;
      if (sy < margin) panY += margin - sy;
      else if (sy > rect.height - margin) panY += rect.height - margin - sy;
      return panX === t.panX && panY === t.panY ? t : { ...t, panX, panY };
    });
  }

  function handleViewportPointerDown(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest('.formula-graph-node')) return;
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setPointerCapture(event.pointerId);
    setInteraction({
      type: 'panning',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialPanX: transformRef.current.panX,
      initialPanY: transformRef.current.panY,
    });
  }

  function handleViewportPointerMove(event: React.PointerEvent) {
    const current = interaction;
    if (current.type === 'idle' || event.pointerId !== current.pointerId) return;
    if (current.type === 'panning') {
      setTransform((t) => ({
        ...t,
        panX: current.initialPanX + (event.clientX - current.startX),
        panY: current.initialPanY + (event.clientY - current.startY),
      }));
    }
  }

  function handleViewportPointerUp(event: React.PointerEvent) {
    const current = interaction;
    if (current.type === 'idle' || event.pointerId !== current.pointerId) return;
    const viewport = viewportRef.current;
    if (viewport && viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    setInteraction({ type: 'idle' });
  }

  return (
    <div
      ref={viewportRef}
      className={`formula-canvas-viewport${interaction.type === 'panning' ? ' is-panning' : ''}`}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handleViewportPointerMove}
      onPointerUp={handleViewportPointerUp}
      onPointerCancel={handleViewportPointerUp}
    >
      <div
        className="formula-canvas-world"
        style={{ transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.scale})`, transformOrigin: '0 0' }}
      >
        <svg
          className="formula-graph-edges"
          width={contentBounds.width}
          height={contentBounds.height}
          viewBox={`0 0 ${contentBounds.width} ${contentBounds.height}`}
          aria-hidden="true"
        >
          {layout.map((item) => {
            if (item.parentId === null) return null;
            const parent = itemsById.get(item.parentId);
            if (!parent) return null;

            const startY = parent.y + parent.height / 2;
            const endY = item.y - item.height / 2;
            const middleY = startY + (endY - startY) * 0.5;
            const isSelectedEdge =
              selectedPathIds.has(parent.node.id) && selectedPathIds.has(item.node.id);
            const isActiveEdge =
              parent.node.status === 'active' && item.node.status === 'active';

            return (
              <path
                key={`${parent.node.id}-${item.node.id}`}
                className={`formula-graph-edge${isActiveEdge ? ' active' : ''}${isSelectedEdge ? ' selected' : ''}`}
                d={`M ${parent.x} ${startY} C ${parent.x} ${middleY}, ${item.x} ${middleY}, ${item.x} ${endY}`}
              />
            );
          })}
        </svg>
        <div className="formula-graph-nodes" role="tree" aria-label="国策树习惯节点">
          {layout.map((item) => {
            const isSelected = selectedFormulaId === item.node.id;
            return (
              <button
                key={item.node.id}
                type="button"
                className={`formula-graph-node${item.node.status === 'active' ? ' active' : ''}${item.depth === 0 ? ' root' : ''}${isSelected ? ' selected' : ''}`}
                style={{ left: item.x, top: item.y, width: item.width, minHeight: item.height }}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-selected={isSelected}
                aria-label={`${item.node.title}，${item.node.status === 'active' ? '已点亮' : '未点亮'}`}
                title={item.node.title}
                onClick={() => onSelect(item.node.id)}
              >
                <span className="formula-graph-node-dot" aria-hidden="true" />
                <span className="formula-graph-node-title">{item.node.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

（本任务先不渲染 root zone、controls、ghost，也未声明 `dragPointer`/`moving`/`flashId`/`didDragRef`/`rootZoneRef`/`DRAG_THRESHOLD`——这些由 Task 7 按需加入；当前只保留被实际使用的 import，保证 `npm run lint` 通过。）

- [ ] **Step 6: 更新 CSS**

在 `src/styles/global.css` 中，把 `.formula-graph-viewport`（2429-2435 行）与 `.formula-graph-canvas`（2437-2450 行，含 `::after`）整块替换为：

```css
.formula-canvas-viewport {
  position: relative;
  height: min(720px, calc(100vh - 260px));
  min-height: 560px;
  overflow: hidden;
  touch-action: none;
  overscroll-behavior: contain;
  background: var(--bg-base);
  cursor: grab;
}

.formula-canvas-viewport.is-panning {
  cursor: grabbing;
}

.formula-canvas-world {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
}
```

- [ ] **Step 7: RSIP.tsx 切换到 FormulaTreeCanvas**

- 删除 RSIP.tsx 中的整个 `FormulaTreeGraph` 组件。
- 删除 `import { findFormulaPath } from ...`（canvas 不再在 RSIP 内使用；若 `getTreeDepth` 仍用则保留）。
- 新增 `import FormulaTreeCanvas from '../features/rsip/FormulaTreeCanvas';`
- 新增状态 `const [highlightId, setHighlightId] = useState<number | null>(null);`
- 替换渲染处（`<FormulaTreeGraph .../>` 处）：

```tsx
<FormulaTreeCanvas
  roots={tree}
  selectedFormulaId={selectedFormulaId}
  highlightId={highlightId}
  onSelect={setSelectedFormulaId}
  onError={(message) => setError(message)}
/>
```

- [ ] **Step 8: 验证**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS

Run: `npm run dev` 手工验证：空白处左键/中键拖动平移画布；画布内滚轮缩放、画布外页面正常滚动；缩放围绕鼠标位置；单击节点仍打开右侧详情；根节点点亮=绿灯、熄灭=灰灯、选中状态灯颜色不变。

- [ ] **Step 9: Commit**

```bash
git add src/features/rsip/formulaTreeGeometry.ts src/features/rsip/formulaTreeGeometry.test.ts src/features/rsip/FormulaTreeCanvas.tsx src/pages/RSIP.tsx src/styles/global.css package.json
git commit -m "无限画布：世界坐标 transform、滚轮缩放与空白平移"
```

---

### Task 5: 画布工具栏（缩放按钮、适应画布、定位选中）

**Files:**
- Modify: `src/features/rsip/FormulaTreeCanvas.tsx`（controls 浮层 + 三个动作）
- Modify: `src/styles/global.css`（controls 样式）

**Interfaces:**
- Consumes: `zoomAtCursor`、`fitTransform`、`revealNode`（Task 4 内部函数）
- Produces: 画布右上角浮层控件 `－` / 百分比 / `＋` / `适应画布` / `定位选中节点`

- [ ] **Step 1: 组件内增加控件渲染与动作**

在 `FormulaTreeCanvas` 中新增：

```tsx
  function zoomByClick(multiplier: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const cursorX = rect.width / 2;
    const cursorY = rect.height / 2;
    // 把期望倍率换算成 deltaY：scale * exp(-deltaY * 0.0015) = scale * multiplier
    const deltaY = -Math.log(multiplier) / 0.0015;
    setTransform((t) => zoomAtCursor(t, cursorX, cursorY, deltaY));
  }

  function fitAll() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setTransform(fitTransform(contentBounds, rect.width, rect.height));
  }

  function locateSelected() {
    if (selectedFormulaId === null) return;
    const item = layout.find((i) => i.node.id === selectedFormulaId);
    if (item) revealNode(item);
  }
```

在 viewport 内、world 之前渲染控件（放在 viewport 根 div 里、world 同级）：

```tsx
      <div className="formula-canvas-controls" aria-label="画布控制">
        <button type="button" aria-label="缩小" onClick={() => zoomByClick(1 / 1.2)}>
          －
        </button>
        <span className="formula-canvas-scale">{Math.round(transform.scale * 100)}%</span>
        <button type="button" aria-label="放大" onClick={() => zoomByClick(1.2)}>
          ＋
        </button>
        <button type="button" onClick={fitAll}>适应画布</button>
        <button type="button" onClick={locateSelected} disabled={selectedFormulaId === null}>
          定位选中节点
        </button>
      </div>
```

- [ ] **Step 2: 控件 CSS**

```css
.formula-canvas-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.formula-canvas-controls button {
  min-width: 26px;
  padding: 2px 7px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.formula-canvas-controls button:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-hover);
}

.formula-canvas-controls button:disabled {
  opacity: 0.45;
  cursor: default;
}

.formula-canvas-scale {
  min-width: 44px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
}
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run lint`
Expected: PASS

Run: `npm run dev` 手工验证：首次加载自动适应画布；＋/－按钮以视口中心放大缩小并显示百分比；适应画布按钮恢复全览；定位选中节点平移视口；新增/拖动后视角不被重置。

- [ ] **Step 4: Commit**

```bash
git add src/features/rsip/FormulaTreeCanvas.tsx src/styles/global.css
git commit -m "画布工具栏：缩放按钮、适应画布与定位选中节点"
```

---

### Task 6: 后端 `move_rsip_formula` 命令 + Rust 测试

**Files:**
- Modify: `src-tauri/src/lib.rs`（核心函数 + 命令 + `invoke_handler` 注册）
- Modify: `src/lib/db/index.ts`（`moveRsipFormula` 封装 + `MoveRsipFormulaResult` 类型）
- Modify: `src/types/index.ts`（无——`RsipFormula` 已有；结果类型放 db 层）

**Interfaces:**
- Consumes: `Database` state、`RSIP_FORMULA_FIELDS`、`get_rsip_formula_json`
- Produces:
  - `fn move_rsip_formula_core(conn: &mut rusqlite::Connection, id: i64, new_parent_id: Option<i64>, new_position: Option<i64>, allow_status_rollback: bool) -> Result<serde_json::Value, String>`（返回 `{ formula, old_parent_id, new_parent_id, deactivated_ids }`，**本任务不写事件**，任务 9 加入 `reparented`）
  - `#[tauri::command] fn move_rsip_formula(...)`（锁 conn 后调 core）
  - `export interface MoveRsipFormulaResult { formula: RsipFormula; old_parent_id: number | null; new_parent_id: number | null; deactivated_ids: number[] }`
  - `export async function moveRsipFormula(params: { id: number; newParentId: number | null; newPosition?: number | null; allowStatusRollback?: boolean }): Promise<MoveRsipFormulaResult>`

- [ ] **Step 1: 写失败测试（先测 core 函数）**

在 `src-tauri/src/lib.rs` 的 `mod tests` 内新增测试 conn 与测试。放在 `rsip_goal_test_conn` 函数之后：

```rust
    fn move_formula_test_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE rsip_formulas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_id INTEGER,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'inactive',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                activated_at TEXT,
                deactivated_at TEXT,
                goal_id INTEGER,
                failure_path_id INTEGER,
                intervention_node_id TEXT,
                dependency_note TEXT
            );

            CREATE TABLE formula_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                formula_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            INSERT INTO rsip_formulas (id, parent_id, title, position, status) VALUES
                (2, NULL, 'Two', 0, 'active'),
                (7, NULL, 'Seven', 1, 'active'),
                (8, 7, 'Eight', 0, 'inactive'),
                (9, 8, 'Nine', 0, 'inactive'),
                (11, NULL, 'Eleven', 2, 'active');
            ",
        )
        .unwrap();
        conn
    }

    fn snapshot_tree(conn: &rusqlite::Connection) -> Vec<(i64, Option<i64>, i64, String)> {
        let mut stmt = conn
            .prepare("SELECT id, parent_id, position, status FROM rsip_formulas ORDER BY id")
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .unwrap();
        rows.map(|row| row.unwrap()).collect()
    }

    fn formula_json_fields(value: &serde_json::Value) -> (Option<i64>, Option<i64>, i64) {
        (
            value["formula"]["parent_id"].as_i64(),
            value["old_parent_id"].as_i64(),
            value["formula"]["position"].as_i64().unwrap(),
        )
    }

    #[test]
    fn move_rsip_formula_root_under_another_root() {
        let mut conn = move_formula_test_conn();
        let result = move_rsip_formula_core(&mut conn, 11, Some(7), None, false).unwrap();
        let (parent, old_parent, position) = formula_json_fields(&result);
        assert_eq!(parent, Some(7));
        assert_eq!(old_parent, None);
        assert_eq!(position, 1);
    }

    #[test]
    fn move_rsip_formula_promotes_child_to_root() {
        let mut conn = move_formula_test_conn();
        let result = move_rsip_formula_core(&mut conn, 8, None, None, false).unwrap();
        let (parent, old_parent, position) = formula_json_fields(&result);
        assert_eq!(parent, None);
        assert_eq!(old_parent, Some(7));
        assert_eq!(position, 3);
    }

    #[test]
    fn move_rsip_formula_rejects_self() {
        let mut conn = move_formula_test_conn();
        let err = move_rsip_formula_core(&mut conn, 7, Some(7), None, false).unwrap_err();
        assert!(err.contains("自身"), "got: {err}");
    }

    #[test]
    fn move_rsip_formula_rejects_descendants() {
        let mut conn = move_formula_test_conn();
        let err = move_rsip_formula_core(&mut conn, 7, Some(8), None, false).unwrap_err();
        assert!(err.contains("子孙"), "got: {err}");
        let err = move_rsip_formula_core(&mut conn, 7, Some(9), None, false).unwrap_err();
        assert!(err.contains("子孙"), "got: {err}");
    }

    #[test]
    fn move_rsip_formula_rejects_missing_target() {
        let mut conn = move_formula_test_conn();
        let err = move_rsip_formula_core(&mut conn, 7, Some(999), None, false).unwrap_err();
        assert!(err.contains("不存在"), "got: {err}");
    }

    #[test]
    fn move_rsip_formula_keeps_sibling_positions_contiguous() {
        let mut conn = move_formula_test_conn();
        move_rsip_formula_core(&mut conn, 11, Some(7), None, false).unwrap();

        let root_positions: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT position FROM rsip_formulas WHERE parent_id IS NULL ORDER BY position")
                .unwrap();
            let rows = stmt
                .query_map([], |row| row.get::<_, i64>(0))
                .unwrap();
            rows.map(|row| row.unwrap()).collect()
        };
        assert_eq!(root_positions, vec![0, 1]);

        let child_positions: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT position FROM rsip_formulas WHERE parent_id = 7 ORDER BY position")
                .unwrap();
            let rows = stmt
                .query_map([], |row| row.get::<_, i64>(0))
                .unwrap();
            rows.map(|row| row.unwrap()).collect()
        };
        assert_eq!(child_positions, vec![0, 1]);
    }

    #[test]
    fn move_rsip_formula_to_inactive_parent_requires_rollback_confirm() {
        let mut conn = move_formula_test_conn();
        // 11 已点亮，8 未点亮：未确认则拒绝
        let err = move_rsip_formula_core(&mut conn, 11, Some(8), None, false).unwrap_err();
        assert!(err.contains("尚未点亮"), "got: {err}");
        // 确认后移动并递归熄灭
        let result = move_rsip_formula_core(&mut conn, 11, Some(8), None, true).unwrap();
        assert_eq!(result["deactivated_ids"].as_array().unwrap(), &serde_json::json!([11]));
        assert_eq!(result["formula"]["status"].as_str(), Some("inactive"));
    }

    #[test]
    fn move_rsip_formula_to_active_parent_keeps_status() {
        let mut conn = move_formula_test_conn();
        let result = move_rsip_formula_core(&mut conn, 2, Some(7), None, false).unwrap();
        assert_eq!(result["formula"]["status"].as_str(), Some("active"));
        assert_eq!(result["deactivated_ids"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn move_rsip_formula_failure_leaves_no_partial_changes() {
        let mut conn = move_formula_test_conn();
        let before = snapshot_tree(&conn);
        // 三类失败：子孙、自身、目标不存在
        assert!(move_rsip_formula_core(&mut conn, 7, Some(8), None, false).is_err());
        assert!(move_rsip_formula_core(&mut conn, 7, Some(7), None, false).is_err());
        assert!(move_rsip_formula_core(&mut conn, 7, Some(999), None, false).is_err());
        assert!(move_rsip_formula_core(&mut conn, 7, Some(7), Some(0), false).is_err());
        let after = snapshot_tree(&conn);
        assert_eq!(before, after, "failed moves must not mutate the tree");
    }

    #[test]
    fn move_rsip_formula_persists_after_reopen() {
        let dir = std::env::temp_dir().join(format!("protocol_move_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("move_test.db");
        let _ = std::fs::remove_file(&path);
        {
            let mut conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE rsip_formulas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    parent_id INTEGER,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'inactive',
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    activated_at TEXT,
                    deactivated_at TEXT,
                    goal_id INTEGER,
                    failure_path_id INTEGER,
                    intervention_node_id TEXT,
                    dependency_note TEXT
                );
                INSERT INTO rsip_formulas (id, parent_id, title, position) VALUES
                    (2, NULL, 'Two', 0),
                    (7, NULL, 'Seven', 1),
                    (8, 7, 'Eight', 0),
                    (11, NULL, 'Eleven', 2);",
            )
            .unwrap();
            move_rsip_formula_core(&mut conn, 11, Some(7), None, false).unwrap();
        }
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            let parent: Option<i64> = conn
                .query_row("SELECT parent_id FROM rsip_formulas WHERE id = 11", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(parent, Some(7));
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(&dir);
    }
```

Run: `cd src-tauri && cargo test`
Expected: FAIL（`move_rsip_formula_core` 未定义）

- [ ] **Step 2: 写实现**

在 `src-tauri/src/lib.rs` 中，`deactivate_rsip_formula`（结束于 2281 行）之后、`get_formula_events` 之前插入：

```rust
#[derive(Debug)]
struct MoveSourceInfo {
    old_parent_id: Option<i64>,
    old_position: i64,
    title: String,
}

fn load_move_source(conn: &rusqlite::Connection, id: i64) -> Result<MoveSourceInfo, String> {
    conn.query_row(
        "SELECT parent_id, position, title FROM rsip_formulas WHERE id = ?1",
        [id],
        |row| {
            Ok(MoveSourceInfo {
                old_parent_id: row.get(0)?,
                old_position: row.get(1)?,
                title: row.get(2)?,
            })
        },
    )
    .map_err(|_| "定式不存在".to_string())
}

fn normalize_formula_title(title: &str) -> String {
    title.trim().to_lowercase()
}

fn has_duplicate_sibling(
    conn: &rusqlite::Connection,
    id: i64,
    new_parent_id: Option<i64>,
    title: &str,
) -> Result<bool, String> {
    let normalized = normalize_formula_title(title);
    let count: i64 = match new_parent_id {
        Some(pid) => conn.query_row(
            "SELECT COUNT(*) FROM rsip_formulas
             WHERE id != ?1 AND parent_id IS ?2 AND LOWER(TRIM(title)) = ?3",
            rusqlite::params![id, pid, normalized],
            |row| row.get(0),
        ),
        None => conn.query_row(
            "SELECT COUNT(*) FROM rsip_formulas
             WHERE id != ?1 AND parent_id IS NULL AND LOWER(TRIM(title)) = ?2",
            rusqlite::params![id, normalized],
            |row| row.get(0),
        ),
    }
    .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

fn resolve_move_position(
    tx: &rusqlite::Transaction<'_>,
    id: i64,
    new_parent_id: Option<i64>,
    new_position: Option<i64>,
) -> Result<i64, String> {
    let sibling_count: i64 = match new_parent_id {
        Some(pid) => tx.query_row(
            "SELECT COUNT(*) FROM rsip_formulas WHERE parent_id = ?1 AND id != ?2",
            rusqlite::params![pid, id],
            |row| row.get(0),
        ),
        None => tx.query_row(
            "SELECT COUNT(*) FROM rsip_formulas WHERE parent_id IS NULL AND id != ?1",
            [id],
            |row| row.get(0),
        ),
    }
    .map_err(|e| e.to_string())?;

    Ok(match new_position {
        Some(requested) => requested.clamp(0, sibling_count),
        None => sibling_count,
    })
}

fn move_rsip_formula_core(
    conn: &mut rusqlite::Connection,
    id: i64,
    new_parent_id: Option<i64>,
    new_position: Option<i64>,
    allow_status_rollback: bool,
) -> Result<serde_json::Value, String> {
    let source = load_move_source(conn, id)?;

    if let Some(pid) = new_parent_id {
        if pid == id {
            return Err("不能把节点移动到自身下".into());
        }
        let parent_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM rsip_formulas WHERE id = ?1",
                [pid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !parent_exists {
            return Err("目标父定式不存在".into());
        }
        let parent_is_descendant: bool = conn
            .query_row(
                "WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM rsip_formulas WHERE parent_id = ?1
                    UNION ALL
                    SELECT f.id FROM rsip_formulas f JOIN descendants d ON f.parent_id = d.id
                 )
                 SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
                rusqlite::params![id, pid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if parent_is_descendant {
            return Err("不能把节点移动到自己的子孙节点下".into());
        }
    }

    if has_duplicate_sibling(conn, id, new_parent_id, &source.title)? {
        return Err("目标层级下已存在同名节点".into());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let position = resolve_move_position(&tx, id, new_parent_id, new_position)?;

    // 从旧兄弟列表中移除并压缩 position
    match source.old_parent_id {
        Some(pid) => tx.execute(
            "UPDATE rsip_formulas
             SET position = position - 1, updated_at = datetime('now')
             WHERE parent_id = ?1 AND id != ?2 AND position > ?3",
            rusqlite::params![pid, id, source.old_position],
        ),
        None => tx.execute(
            "UPDATE rsip_formulas
             SET position = position - 1, updated_at = datetime('now')
             WHERE parent_id IS NULL AND id != ?1 AND position > ?2",
            rusqlite::params![id, source.old_position],
        ),
    }
    .map_err(|e| e.to_string())?;

    // 在新兄弟列表中插入位置并让位
    match new_parent_id {
        Some(pid) => tx.execute(
            "UPDATE rsip_formulas
             SET position = position + 1, updated_at = datetime('now')
             WHERE parent_id = ?1 AND id != ?2 AND position >= ?3",
            rusqlite::params![pid, id, position],
        ),
        None => tx.execute(
            "UPDATE rsip_formulas
             SET position = position + 1, updated_at = datetime('now')
             WHERE parent_id IS NULL AND id != ?1 AND position >= ?2",
            rusqlite::params![id, position],
        ),
    }
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE rsip_formulas
         SET parent_id = ?2,
             position = ?3,
             dependency_note = NULL,
             updated_at = datetime('now')
         WHERE id = ?1",
        rusqlite::params![id, new_parent_id, position],
    )
    .map_err(|e| e.to_string())?;

    let mut deactivated_ids: Vec<i64> = Vec::new();
    if let Some(pid) = new_parent_id {
        let parent_status: String = tx
            .query_row("SELECT status FROM rsip_formulas WHERE id = ?1", [pid], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        if parent_status == "inactive" {
            let active_in_subtree: Vec<i64> = {
                let mut stmt = tx
                    .prepare(
                        "WITH RECURSIVE descendants(id) AS (
                            SELECT id FROM rsip_formulas WHERE parent_id = ?1
                            UNION ALL
                            SELECT f.id FROM rsip_formulas f JOIN descendants d ON f.parent_id = d.id
                         )
                         SELECT id FROM rsip_formulas
                         WHERE id IN (SELECT id FROM descendants UNION ALL SELECT ?1)
                           AND status = 'active'
                         ORDER BY id",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([id], |row| row.get::<_, i64>(0))
                    .map_err(|e| e.to_string())?;
                let mut ids = Vec::new();
                for row in rows {
                    ids.push(row.map_err(|e| e.to_string())?);
                }
                ids
            };
            if !active_in_subtree.is_empty() {
                if !allow_status_rollback {
                    return Err("目标父定式尚未点亮，移动将熄灭该节点及其已点亮子节点".into());
                }
                for child_id in &active_in_subtree {
                    tx.execute(
                        "UPDATE rsip_formulas
                         SET status = 'inactive',
                             deactivated_at = datetime('now'),
                             updated_at = datetime('now')
                         WHERE id = ?1",
                        [child_id],
                    )
                    .map_err(|e| e.to_string())?;
                    tx.execute(
                        "INSERT INTO formula_events (formula_id, event_type, note)
                         VALUES (?1, 'rollback_child_deactivated', ?2)",
                        rusqlite::params![
                            child_id,
                            format!("移动至未点亮父定式 {}，触发递归熄灭", pid)
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
                deactivated_ids = active_in_subtree;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    let formula = get_rsip_formula_json(conn, id)?;
    Ok(serde_json::json!({
        "formula": formula,
        "old_parent_id": source.old_parent_id,
        "new_parent_id": new_parent_id,
        "deactivated_ids": deactivated_ids,
    }))
}

#[tauri::command]
fn move_rsip_formula(
    state: tauri::State<'_, Database>,
    id: i64,
    new_parent_id: Option<i64>,
    new_position: Option<i64>,
    allow_status_rollback: bool,
) -> Result<serde_json::Value, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    move_rsip_formula_core(&mut conn, id, new_parent_id, new_position, allow_status_rollback)
}
```

注意 `debug_assert_eq!(removed, 0, ...)` 的语义是"确认压缩 update 是幂等安全的"——这里其实应该是 **不** 断言（`removed` 表示受影响行数，压缩必然影响若干行）。改为直接忽略返回值：

```rust
    let _ = match source.old_parent_id {
        ...
    }.map_err(|e| e.to_string())?;
```

在 `invoke_handler` 列表（`deactivate_rsip_formula,` 之后）注册 `move_rsip_formula,`。

- [ ] **Step 3: 运行测试确认通过**

Run: `cd src-tauri && cargo test`
Expected: PASS（新增 9 个测试全绿，原有测试不回归）

- [ ] **Step 4: 前端封装**

`src/lib/db/index.ts` 末尾（`getFormulaEvents` 附近）新增：

```ts
export interface MoveRsipFormulaResult {
  formula: RsipFormula;
  old_parent_id: number | null;
  new_parent_id: number | null;
  deactivated_ids: number[];
}

export async function moveRsipFormula(params: {
  id: number;
  newParentId: number | null;
  newPosition?: number | null;
  allowStatusRollback?: boolean;
}): Promise<MoveRsipFormulaResult> {
  return invoke('move_rsip_formula', {
    id: params.id,
    newParentId: params.newParentId,
    newPosition: params.newPosition ?? null,
    allowStatusRollback: params.allowStatusRollback ?? false,
  });
}
```

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src/lib/db/index.ts
git commit -m "后端：move_rsip_formula 事务命令，含循环防护、position 整理与递归熄灭"
```

---

### Task 7: 节点拖拽、候选父节点与根节点放置区

**Files:**
- Modify: `src/features/rsip/FormulaTreeCanvas.tsx`（拖拽状态机、ghost、预览线、root zone、命中测试、移动请求）
- Modify: `src/styles/global.css`（拖拽视觉样式）
- Modify: `src/pages/RSIP.tsx`（`onMoved` 回调：reload + 提示 + 高亮）

**Interfaces:**
- Consumes: Task 6 的 `moveRsipFormula`/`MoveRsipFormulaResult`；Task 2 的 `collectSubtreeIds`/`findFormulaNode`/`nodeRect`；Task 4 的 `screenToWorld`/`isPointInsideExpandedRect`/`worldToScreen`
- Produces: `FormulaTreeCanvas` 新增 props：`onMoved: (result: MoveRsipFormulaResult) => void | Promise<void>`；拖动交互完成

- [ ] **Step 1: imports 补充、props 与状态扩展**

在 Task 4 的 import 基础上追加：

```tsx
import { moveRsipFormula, type MoveRsipFormulaResult } from '../../lib/db';
import {
  collectSubtreeIds,
  findFormulaNode,
  nodeRect,
  type FormulaTreeNode,
  type LayoutNode,
} from './formulaTreeLayout';
import { isPointInsideExpandedRect } from './formulaTreeGeometry';
```

组件 props 增加 `onMoved`：

```tsx
export default function FormulaTreeCanvas({
  roots,
  selectedFormulaId,
  highlightId,
  onSelect,
  onMoved,
  onError,
}: {
  roots: FormulaTreeNode[];
  selectedFormulaId: number | null;
  highlightId: number | null;
  onSelect: (id: number) => void;
  onMoved: (result: MoveRsipFormulaResult) => void | Promise<void>;
  onError: (message: string) => void;
}) {
```

新增常量与 refs/state（插在现有 refs/state 旁）：

```tsx
const DRAG_THRESHOLD = 6;

  const rootZoneRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);

  const [moving, setMoving] = useState(false);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [dragPointer, setDragPointer] = useState<{
    screen: { x: number; y: number };
    world: { x: number; y: number };
  } | null>(null);
```

更新 `InteractionState` 的 dragging-node 变体，加入 `overRootZone: boolean`（Task 4 定义的是不带该字段的版本，此处整体替换类型定义）。

- [ ] **Step 2: 辅助函数与移动提交**

```tsx
  function subtreeHasActive(node: FormulaTreeNode): boolean {
    if (node.status === 'active') return true;
    return node.children.some(subtreeHasActive);
  }

  function subtreeHasActive(node: FormulaTreeNode): boolean {
    if (node.status === 'active') return true;
    return node.children.some(subtreeHasActive);
  }

  function isPointInRootZone(x: number, y: number): boolean {
    const zone = rootZoneRef.current;
    const viewport = viewportRef.current;
    if (!zone || !viewport) return false;
    const zoneRect = zone.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    return (
      x >= zoneRect.left - viewportRect.left &&
      x <= zoneRect.right - viewportRect.left &&
      y >= zoneRect.top - viewportRect.top &&
      y <= zoneRect.bottom - viewportRect.top
    );
  }

  function hitTest(world: { x: number; y: number }, draggedId: number): number | null {
    const banned = new Set<number>();
    const dragged = findFormulaNode(roots, draggedId);
    if (dragged) collectSubtreeIds(dragged, banned);
    let best: LayoutNode | null = null;
    let bestDistance = Infinity;
    for (const item of layout) {
      if (item.node.id === draggedId || banned.has(item.node.id)) continue;
      if (!isPointInsideExpandedRect(world, nodeRect(item), 14)) continue;
      const d = (world.x - item.x) ** 2 + (world.y - item.y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = item;
      }
    }
    return best ? best.node.id : null;
  }

  function updateDragPointer(event: React.PointerEvent) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY, rect, transformRef.current);
    setDragPointer({
      screen: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      world,
    });
  }

  async function commitMove(nodeId: number, newParentId: number | null) {
    const moved = findFormulaNode(roots, nodeId);
    if (!moved) return;
    const target = newParentId === null ? null : findFormulaNode(roots, newParentId);
    let allowRollback = false;
    if (target && target.status === 'inactive' && subtreeHasActive(moved)) {
      if (!window.confirm('目标父节点尚未点亮。继续移动将熄灭该节点及其已点亮子节点。')) {
        return;
      }
      allowRollback = true;
    }
    setMoving(true);
    try {
      const result = await moveRsipFormula({
        id: nodeId,
        newParentId,
        allowStatusRollback: allowRollback,
      });
      await onMoved(result);
    } catch (err) {
      onError(String(err));
    } finally {
      setMoving(false);
    }
  }
```

- [ ] **Step 3: 节点按下 / 视图指针处理**

```tsx
  function handleNodePointerDown(event: React.PointerEvent, nodeId: number) {
    if (moving) return;
    event.stopPropagation();
    if (event.button !== 0) return;
    didDragRef.current = false;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setPointerCapture(event.pointerId);
    setInteraction({
      type: 'pending-node-drag',
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    });
  }
```

`handleViewportPointerDown` 开头增加 `if (moving) return;`。

`handleViewportPointerMove` 展开为完整状态机（替换 Task 4 的版本）：

```tsx
  function handleViewportPointerMove(event: React.PointerEvent) {
    const current = interaction;
    if (current.type === 'idle' || event.pointerId !== current.pointerId) return;

    if (current.type === 'panning') {
      setTransform((t) => ({
        ...t,
        panX: current.initialPanX + (event.clientX - current.startX),
        panY: current.initialPanY + (event.clientY - current.startY),
      }));
      return;
    }

    if (current.type === 'pending-node-drag') {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= DRAG_THRESHOLD) {
        return;
      }
      didDragRef.current = true;
      updateDragPointer(event);
      setInteraction({
        type: 'dragging-node',
        nodeId: current.nodeId,
        pointerId: current.pointerId,
        targetParentId: null,
        overRootZone: false,
      });
      return;
    }

    if (current.type === 'dragging-node') {
      updateDragPointer(event);
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const overRootZone = isPointInRootZone(px, py);
      const world = screenToWorld(event.clientX, event.clientY, rect, transformRef.current);
      const target = overRootZone ? null : hitTest(world, current.nodeId);
      setInteraction((prev) =>
        prev.type === 'dragging-node'
          ? { ...prev, targetParentId: target, overRootZone }
          : prev,
      );
    }
  }
```

`handleViewportPointerUp` 替换为：

```tsx
  function handleViewportPointerUp(event: React.PointerEvent) {
    const current = interaction;
    if (current.type === 'idle' || event.pointerId !== current.pointerId) return;
    const viewport = viewportRef.current;
    if (viewport && viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    if (current.type === 'pending-node-drag') {
      onSelect(current.nodeId);
      setInteraction({ type: 'idle' });
      return;
    }

    if (current.type === 'dragging-node') {
      const dropWorld = dragPointer?.world;
      setDragPointer(null);
      setInteraction({ type: 'idle' });
      if (!dropWorld) return;
      if (!current.overRootZone && current.targetParentId === null) return; // 空白区域取消
      const target = current.overRootZone ? null : current.targetParentId;
      if (target === current.nodeId) return;
      commitMove(current.nodeId, target);
      return;
    }

    if (current.type === 'panning') {
      setInteraction({ type: 'idle' });
    }
  }
```

节点按钮增加 `onPointerDown` 与点击防误触：

```tsx
                  onPointerDown={(event) => handleNodePointerDown(event, item.node.id)}
                  onClick={() => {
                    if (!didDragRef.current) onSelect(item.node.id);
                  }}
```

- [ ] **Step 4: 拖拽视觉渲染**

节点 className 追加（在原有 active/root/selected 之后）：

```tsx
                    className={`formula-graph-node${item.node.status === 'active' ? ' active' : ''}${item.depth === 0 ? ' root' : ''}${isSelected ? ' selected' : ''}${interaction.type === 'dragging-node' && interaction.nodeId === item.node.id ? ' is-dragging' : ''}${interaction.type === 'dragging-node' && interaction.targetParentId === item.node.id ? ' is-drop-target' : ''}${flashId === item.node.id ? ' flash-new' : ''}`}
```

在 SVG edges 内、路径列表末尾追加预览线（拖拽且命中合法目标时）：

```tsx
          {interaction.type === 'dragging-node' &&
            interaction.targetParentId !== null &&
            !interaction.overRootZone &&
            dragPointer &&
            (() => {
              const target = itemsById.get(interaction.targetParentId);
              if (!target) return null;
              const midY = (dragPointer.world.y + target.y) / 2;
              return (
                <path
                  className="formula-graph-drag-preview"
                  d={`M ${dragPointer.world.x} ${dragPointer.world.y} C ${dragPointer.world.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y}`}
                />
              );
            })()}
```

在 `.formula-graph-nodes` 容器内末尾追加拖拽影子（世界坐标，随缩放）:

```tsx
          {interaction.type === 'dragging-node' && dragPointer && (() => {
            const moved = findFormulaNode(roots, interaction.nodeId);
            if (!moved) return null;
            return (
              <div
                className="formula-graph-node-drag-ghost"
                style={{ left: dragPointer.world.x, top: dragPointer.world.y }}
              >
                <span className="formula-graph-node-dot" aria-hidden="true" />
                <span className="formula-graph-node-title">{moved.title}</span>
              </div>
            );
          })()}
```

在 viewport 内、world 之前渲染根节点放置区（与 controls 同级）：

```tsx
      <div
        ref={rootZoneRef}
        className={`formula-canvas-root-zone${interaction.type === 'dragging-node' ? ' visible' : ''}${interaction.type === 'dragging-node' && interaction.overRootZone ? ' active' : ''}`}
        aria-hidden="true"
      >
        拖到这里，提升为根节点
      </div>
```

- [ ] **Step 5: 拖拽视觉 CSS**

```css
.formula-canvas-root-zone {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 44px;
  display: none;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  background: var(--bg-card);
  border-bottom: 1px dashed var(--border-hover);
  font-size: 12px;
  z-index: 4;
}

.formula-canvas-root-zone.visible {
  display: flex;
}

.formula-canvas-root-zone.active {
  color: var(--gold);
  border-color: var(--gold-border);
  background: var(--gold-subtle);
}

.formula-graph-node.is-dragging {
  opacity: 0.35;
}

.formula-graph-node.is-drop-target {
  border-color: var(--gold);
  box-shadow: inset 3px 0 0 var(--gold);
}

.formula-graph-drag-preview {
  fill: none;
  stroke: var(--gold);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.formula-graph-node-drag-ghost {
  position: absolute;
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  color: var(--text-primary);
  background: var(--gold-subtle);
  border: 1px solid var(--gold-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  transform: translate(-50%, -50%);
  z-index: 3;
}

.formula-graph-node.flash-new {
  animation: formula-node-flash 1s ease-out;
}

@keyframes formula-node-flash {
  0% {
    box-shadow: 0 0 0 3px var(--gold);
  }
  100% {
    box-shadow: 0 0 0 3px transparent;
  }
}

.formula-canvas-world.animating-move .formula-graph-node {
  transition: left 0.2s ease, top 0.2s ease;
}
```

- [ ] **Step 6: RSIP.tsx 处理移动结果**

`FormulaTreeCanvas` props 增加 `onMoved`，并新增处理器：

```tsx
  async function handleMoved(result: MoveRsipFormulaResult) {
    await reload();
    setSelectedFormulaId(result.formula.id);
    setHighlightId(result.formula.id);
    const movedTitle = result.formula.title;
    if (result.new_parent_id === null) {
      setActionFeedback({ tone: 'success', text: `已将「${movedTitle}」提升为根节点。` });
    } else {
      const targetTitle =
        formulas.find((f) => f.id === result.new_parent_id)?.title ?? `#${result.new_parent_id}`;
      const rollbackNote =
        result.deactivated_ids.length > 0
          ? `；递归熄灭了 ${result.deactivated_ids.length} 个已点亮节点`
          : '';
      setActionFeedback({
        tone: 'success',
        text: `已将「${movedTitle}」移动到「${targetTitle}」下${rollbackNote}。`,
      });
    }
  }
```

import：`import type { MoveRsipFormulaResult } from '../lib/db';`（RSIP 只用到结果类型，`moveRsipFormula` 由 canvas 调用）。

渲染处：

```tsx
<FormulaTreeCanvas
  roots={tree}
  selectedFormulaId={selectedFormulaId}
  highlightId={highlightId}
  onSelect={setSelectedFormulaId}
  onMoved={handleMoved}
  onError={(message) => setError(message)}
/>
```

- [ ] **Step 7: 验证**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS

Run: `npm run dev` 手工验收：
- 拖动"11"到"7"上 → "7"高亮、出现虚线预览 → 松开 → 提示"已将「11」移动到「7」下" → 重新布局且"11"成为"7"的子节点 → 刷新/重启后关系保持。
- 拖动父节点到子孙节点上 → 子孙不进入候选（无高亮），松开放空白处取消。
- 拖到顶部根放置区 → "提升为根节点"。
- 拖动影子跟随鼠标；原节点半透明；单击（未达 6px 阈值）仍只选中。
- 移动结束后节点位置过渡动画约 200ms。

- [ ] **Step 8: Commit**

```bash
git add src/features/rsip/FormulaTreeCanvas.tsx src/styles/global.css src/pages/RSIP.tsx
git commit -m "节点拖拽：候选父节点高亮、根放置区与移动请求"
```

---

### Task 8: 移动后过渡动画、高亮与错误恢复

**Files:**
- Modify: `src/features/rsip/FormulaTreeCanvas.tsx`

**Interfaces:**
- Consumes: Task 7 的 `commitMove`、`flashId`
- Produces: 移动成功后 220ms 位置过渡（`animating-move` 类）、flash 计时器、失败时恢复交互状态

- [ ] **Step 1: 过渡动画与 flash 计时器**

在 `commitMove` 的 try 块中加动画与 flash（Task 7 的版本只有 `await onMoved(result)` 与 `setMoving`，此处把 try 块整体替换为下面版本，其余部分不动）：

```tsx
    setMoving(true);
    try {
      const result = await moveRsipFormula({
        id: nodeId,
        newParentId,
        allowStatusRollback: allowRollback,
      });
      setFlashId(nodeId);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlashId(null), 1000);
      await onMoved(result);
      setMoveAnimating(true);
      window.setTimeout(() => setMoveAnimating(false), 220);
    } catch (err) {
      onError(String(err));
    } finally {
      setMoving(false);
    }
```

新增状态：`const [moveAnimating, setMoveAnimating] = useState(false);`，另加 `const flashTimerRef = useRef<number | null>(null);`，在 `useEffect` cleanup 中 `window.clearTimeout(flashTimerRef.current)`（卸载时清理计时器，避免卸载后 setState）。flash 计时器写入 `flashTimerRef.current = window.setTimeout(...)`。

world 容器 className 改为：

```tsx
      <div
        className={`formula-canvas-world${moveAnimating ? ' animating-move' : ''}`}
        style={{ transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.scale})`, transformOrigin: '0 0' }}
      >
```

（setTimeout 清理：用一个 ref 记录 timer id，`useEffect` cleanup 中清除，避免卸载后 setState。）

- [ ] **Step 2: 验证**

Run: `npm run typecheck && npm run lint`
Expected: PASS

Run: `npm run dev` 手工验证：移动后节点平滑过渡到新位置；新节点 1 秒金色闪烁；后端报错（如数据库只读）时提示错误且画布可继续操作。

- [ ] **Step 3: Commit**

```bash
git add src/features/rsip/FormulaTreeCanvas.tsx
git commit -m "移动动画与高亮闪烁，失败时错误提示"
```

---

### Task 9: `reparented` 事件 + 数据库迁移

**Files:**
- Modify: `src-tauri/src/db.rs`（迁移函数 + 新建表 CHECK 更新）
- Modify: `src/lib/db/schema.sql`（文档同步）
- Modify: `src-tauri/src/lib.rs`（move 命令内写入 `reparented` 事件）
- Modify: `src/types/index.ts`（事件类型联合加 `'reparented'`）
- Modify: `src/lib/protocolEvents.ts`（文案）

**Interfaces:**
- Consumes: Task 6 的 move core（tx 内插入事件）
- Produces: `formula_events.event_type` CHECK 包含 `'reparented'`；`FormulaEvent['event_type']` 联合含 `'reparented'`；`formulaEventLabel('reparented') === '调整父节点'`

- [ ] **Step 1: db.rs 迁移**

在 `migrate_rsip_goal_translation_schema` 之后新增（并在 `initialize_schema` 的迁移调用序列中追加）：

```rust
fn migrate_formula_events_reparented(conn: &Connection) -> SqliteResult<()> {
    let sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'formula_events'",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(sql_text) = sql {
        if sql_text.contains("reparented") {
            return Ok(());
        }
    }

    conn.execute_batch(
        "
        PRAGMA foreign_keys=OFF;
        BEGIN TRANSACTION;
        ALTER TABLE formula_events RENAME TO formula_events_v2beta_legacy;
        CREATE TABLE formula_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            formula_id INTEGER NOT NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('created', 'activated', 'deactivated', 'rollback_child_deactivated', 'reparented')),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (formula_id) REFERENCES rsip_formulas(id) ON DELETE CASCADE
        );
        INSERT INTO formula_events (id, formula_id, event_type, note, created_at)
        SELECT id, formula_id, event_type, note, created_at FROM formula_events_v2beta_legacy;
        DROP TABLE formula_events_v2beta_legacy;
        COMMIT;
        PRAGMA foreign_keys=ON;
        ",
    )?;

    Ok(())
}
```

同时把 `initialize_schema` 里 `CREATE TABLE formula_events` 的 CHECK（143 行）更新为包含 `'reparented'`。

- [ ] **Step 2: schema.sql 同步**

`src/lib/db/schema.sql` 第 117 行 CHECK 改为：

```sql
event_type TEXT NOT NULL CHECK(event_type IN ('created', 'activated', 'deactivated', 'rollback_child_deactivated', 'reparented')),
```

- [ ] **Step 3: move 命令写事件**

Task 6 的 `move_rsip_formula_core` 中，在 `tx.commit()` 之前插入：

```rust
    if source.old_parent_id != new_parent_id {
        let event_note = match (source.old_parent_id, new_parent_id) {
            (None, Some(pid)) => {
                let title: String = tx
                    .query_row("SELECT title FROM rsip_formulas WHERE id = ?1", [pid], |row| {
                        row.get(0)
                    })
                    .map_err(|e| e.to_string())?;
                format!("从根节点移动到「{title}」下")
            }
            (Some(oid), Some(pid)) => {
                let old_title: String = tx
                    .query_row(
                        "SELECT title FROM rsip_formulas WHERE id = ?1",
                        [oid],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                let new_title: String = tx
                    .query_row(
                        "SELECT title FROM rsip_formulas WHERE id = ?1",
                        [pid],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                format!("从「{old_title}」移动到「{new_title}」下")
            }
            (Some(oid), None) => {
                let title: String = tx
                    .query_row("SELECT title FROM rsip_formulas WHERE id = ?1", [oid], |row| {
                        row.get(0)
                    })
                    .map_err(|e| e.to_string())?;
                format!("从「{title}」下提升为根节点")
            }
            (None, None) => "调整了父节点".to_string(),
        };
        tx.execute(
            "INSERT INTO formula_events (formula_id, event_type, note) VALUES (?1, 'reparented', ?2)",
            rusqlite::params![id, event_note],
        )
        .map_err(|e| e.to_string())?;
    }
```

在 `move_rsip_formula_root_under_another_root` 测试中追加断言（验证事件写入）：

```rust
        let event_type: String = conn
            .query_row(
                "SELECT event_type FROM formula_events WHERE formula_id = 11 ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event_type, "reparented");
```

- [ ] **Step 4: 前端类型与文案**

`src/types/index.ts` 事件联合（227-231 行）改为：

```ts
  event_type:
    | 'created'
    | 'activated'
    | 'deactivated'
    | 'rollback_child_deactivated'
    | 'reparented';
```

`src/lib/protocolEvents.ts` 三处函数各自追加一行：

```ts
export function rsipSummaryEventLabel(type: string): string {
  if (type === 'created') return '定式创建';
  if (type === 'activated') return '定式点亮';
  if (type === 'deactivated') return '定式熄灭';
  if (type === 'rollback_child_deactivated') return '递归回滚';
  if (type === 'reparented') return '定式调整父节点';
  return type;
}

export function rsipTimelineEventLabel(type: string): string {
  if (type === 'created') return 'RSIP 定式创建';
  if (type === 'activated') return 'RSIP 定式点亮';
  if (type === 'deactivated') return 'RSIP 定式熄灭';
  if (type === 'rollback_child_deactivated') return 'RSIP 子定式回滚熄灭';
  if (type === 'reparented') return 'RSIP 定式调整父节点';
  return type;
}

export function formulaEventLabel(type: FormulaEvent['event_type']): string {
  if (type === 'created') return '加入定式树';
  if (type === 'activated') return '点亮';
  if (type === 'deactivated') return '熄灭';
  if (type === 'reparented') return '调整父节点';
  return '递归回滚';
}
```

- [ ] **Step 5: 验证**

Run: `cd src-tauri && cargo test`
Expected: PASS（含新增事件断言）

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs src/lib/db/schema.sql src/types/index.ts src/lib/protocolEvents.ts
git commit -m "reparented 事件：表重建迁移、事件写入与界面文案"
```

---

### Task 10: 新增节点自动定位 + 依赖说明提示

**Files:**
- Modify: `src/pages/RSIP.tsx`（创建成功后 setHighlightId；移动清空依赖说明的提示）

**Interfaces:**
- Consumes: Task 4 的 `highlightId` prop 机制
- Produces: 新增节点自动 reveal + 1s 高亮；移动后提示原依赖说明已清空

- [ ] **Step 1: 创建后高亮**

`handleCreate` 成功路径（`setSelectedFormulaId(created.id);` 之后）加：

```tsx
      setHighlightId(created.id);
```

新增根节点由布局自动排在所有根节点右侧（`layoutForest` 已保证），canvas 的 reveal 逻辑会把它平移到可见范围。

- [ ] **Step 2: 依赖说明清空提示**

`handleMoved` 中，当 `result.old_parent_id !== null && result.formula.dependency_note === null`（后端已清空）时，在提示末尾追加：

```tsx
      const movedTitle = result.formula.title;
      const noteHint =
        result.old_parent_id !== null && result.formula.dependency_note === null
          ? ' 原依赖说明已随移动清空，如需保留依赖关系请重新填写。'
          : '';
```

并把它拼进 feedback 文案（根节点与子节点两种文案的末尾）。

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS

Run: `npm run dev` 手工验收：新增根节点出现在最右侧并自动平移到可见、闪烁 1 秒；新增子节点出现在父节点下方、兄弟旁；拖动后依赖说明被清空且提示出现。

- [ ] **Step 4: Commit**

```bash
git add src/pages/RSIP.tsx
git commit -m "新增节点自动定位高亮，移动后提示重新填写依赖说明"
```

---

### Task 11: 完整验证

**Files:**
- 无（只运行验证）

- [ ] **Step 1: 前端全量检查**

Run: `npm run check`
Expected: PASS（`node` 三份测试 + `tsc -b --noEmit` + eslint）

Run: `npm run build`
Expected: PASS（tsc -b + vite build 产出 dist）

- [ ] **Step 2: 后端全量检查**

Run: `cd src-tauri && cargo test`
Expected: PASS（全部测试，含新增 move 与事件测试）

- [ ] **Step 3: 手工验收清单**

对照规格逐项确认：
1. 根节点点亮=绿灯、熄灭=灰灯；选中节点状态灯颜色不变（Task 1）。
2. 30 个根节点互相不覆盖，可缩放平移查看（Task 2/4）。
3. 画布内滚轮缩放（围绕鼠标）、画布外页面正常滚动（Task 4）。
4. 空白/中键拖动平移画布；单击节点打开右侧详情；轻移不误触拖拽（Task 4/7）。
5. 把"11"拖到"7"→ 成为"7"的子节点；刷新/重启后保持（Task 6/7）。
6. 不能制造循环结构（拖到子孙/自己无效）；空白松开取消（Task 7）。
7. 拖到根放置区 → 提升为根节点（Task 7）。
8. 移动到未点亮父节点弹出确认，确认后递归熄灭并提示（Task 7/8）。
9. 新节点自动出现在正确父节点附近并高亮，不随机出现远处（Task 10）。
10. 事件列表出现"调整父节点"（Task 9）。

- [ ] **Step 4: 汇报**

汇总：`npm run check`、`npm run build`、`cargo test` 的实际输出与手工验收结果；列出所有改动文件清单。
