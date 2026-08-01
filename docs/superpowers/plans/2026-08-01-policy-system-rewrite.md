# 国策模块完整改造 Implementation Plan

> **Goal:** 将现有 RSIP 模块重构为"国策系统"：四层数据模型（Policy / TreeNode / PolicyCycle / PolicyEvent）、三标签页路由（国策树 / 国策库 / 复盘）、无限画布拖拽（复用已建布局引擎）、国策库独立管理、执行周期追踪、事实型复盘。

**Architecture:** 单表 `rsip_formulas` 拆为四表；Rust 命令全部重写（保留现有激活/熄灭/移动语义但改为新模型）；前端 `/policies/*` 路由，`PolicyProvider` 作为数据层；布局与几何纯函数复用已有 `formulaTreeLayout.ts` / `formulaTreeGeometry.ts`（改类型签名）。

**Tech Stack:** 同现有：React 19 + TypeScript + Vite + Tauri 2 + rusqlite 0.31。不增加新依赖。

## Global Constraints
- 术语统一："国策"（policy）而非"RSIP/定式"；"点亮/熄灭"而非"active/inactive"
- 数据库四表分离：Policy（国策内容）、TreeNode（树位置）、PolicyCycle（执行周期）、PolicyEvent（事件）
- 父节点熄灭不级联子节点；每个节点状态独立
- 从树移除 ≠ 删除；国策库永久删除才真正删除
- 节点坐标不入库，始终由布局函数计算
- 不引入新依赖
- 保留工作区已有改动
- UI 中文，匹配现有 CSS 变量体系
- 测试用 Node 原生跑 TS（同现有模式）
- 最终验证：`npm run check` + `npm run build` + `cargo test`

## 十条实施轨道

### Track A: 后端四表数据模型 + 迁移 + 基础命令

**文件:** `src-tauri/src/db.rs`（新表 + 迁移函数）、`src-tauri/src/lib.rs`（新命令集）、`src/lib/db/schema.sql`（文档同步）、`src/types/index.ts`（新类型）

**任务:**
1. 新表定义：`policies`（id, name, description, created_at, updated_at）、`policy_tree_nodes`（id, policy_id, parent_node_id, sibling_order, status, added_at）、`policy_cycles`（id, policy_id, tree_node_id, started_at, ended_at, end_reason）、`policy_events`（id, policy_id, type, reason, metadata, created_at）。约束：status ∈ ('lit', 'extinguished')，event type ∈ ('added_to_tree', 'removed_from_tree', 'lit', 'extinguished', 'reparented', 'reordered', 'renamed')。
2. 迁移函数：创建新表 → 从 `rsip_formulas`/`formula_events` 迁移旧数据（旧 name→policies.name，旧 status active→lit/inactive→extinguished，旧 parent_id→policy_tree_nodes 拓扑，旧 events→policy_events）→ 保留旧表改名为 `_v0.5_backup` 不做 DROP。
3. 基础 Rust 命令：`create_policy`, `get_policies`, `update_policy`, `add_policy_to_tree`, `remove_policy_from_tree`, `reparent_tree_node`, `reorder_tree_node`, `light_policy`, `extinguish_policy`, `get_policy_tree`, `get_policy_events`, `get_policy_cycles`, `permanently_delete_policy`，`get_policy_library`。
4. 前端封装：`src/lib/db/policies.ts`（所有命令的 TS wrapper）。
5. Rust 测试：创建→入库→查回；移入/移出树；点亮/熄灭/重排/重新挂载；子树移除但不删除；永久删除 + 子树处理；事件与周期记录完整性。

### Track B: 前端路由 + 三标签页壳 + PolicyProvider

**文件:** `src/App.tsx`（路由）、`src/pages/Policies.tsx`（标签页容器）、`src/features/policies/PolicyProvider.tsx`（数据层）

**任务:**
1. `/policies/tree`、`/policies/library`、`/policies/review` 三个子路由。
2. `Policies.tsx`：顶部 "国策树｜国策库｜复盘" 标签栏，`<Outlet>` 渲染子页面。切换标签页时保留状态。
3. `PolicyProvider`：useState 管理 policies/treeNodes/cycles/events，提供 `reload()`、`selectedNodeId`、`isDetailPanelOpen`。
4. 侧边栏 `Sidebar.tsx`："RSIP" → "国策"，`/rsip` → `/policies/tree`。

### Track C: 国策树画布（复用布局引擎）

**文件:** `src/features/policies/PolicyTreeCanvas.tsx`（改自 `FormulaTreeCanvas.tsx`）、`src/features/policies/policyTreeLayout.ts`（改自 `formulaTreeLayout.ts`）

**任务:**
1. 改 `PolicyTreeNode` 类型（替换 `RsipFormula`），布局函数签名同步变更。
2. 画布：结构同现有无限画布（viewport/world/transform/Pointer Events）。缩放范围 30%-200%（规格）。
3. 节点视觉：四种独立状态（点亮=绿灯+正常亮度、熄灭=灰灯+降低亮度、选中=金色边框、根节点=ROOT标签+特殊轮廓；状态灯永远不受 root/selected 影响）。
4. 拖动：复用现有交互状态机 + 根节点放置区 + 循环防护 + 插入指示线（同级排序新增）。
5. 顶部统计：仅国策总数/已点亮/已熄灭（从 treeNodes 计算）。
6. 适应画布/缩放按钮/比例显示（同现有工具栏）。

### Track D: 详情页 + 点亮/熄灭 + 执行周期

**文件:** `src/features/policies/PolicyDetailPanel.tsx`、`src/pages/PoliciesTree.tsx`

**任务:**
1. 详情页滑入/滑出动画（`transform: translateX` + `transition`），展开/收起不跳动画布。
2. 双击同一节点 = 收起详情；单击空白 = 收起；单击另一节点 = 切换。
3. 详情内容：当前状态、名称、执行说明、本轮点亮时间、点亮/熄灭按钮、从树移除、保存。
4. 点亮：新节点默认点亮 → 创建 `PolicyCycle` 记录开始时间。
5. 熄灭：点击后立即变灰 → `PolicyCycle.endedAt = now` → 5-8s toast（"撤销｜补充原因"）→ 原因可选。
6. 重新点亮：创建新 `PolicyCycle`，显示"本轮已点亮 N 天"。
7. 父节点熄灭不级联子节点。

### Track E: 国策库页面

**文件:** `src/pages/PoliciesLibrary.tsx`

**任务:**
1. 紧凑列表：每行 = 状态标签 + 名称 + 简短描述 + "已加入/未加入" + 操作按钮。
2. 筛选：全部/已加入/未加入/已点亮/已熄灭；搜索框。
3. "加入国策树"弹窗：选择父节点（根节点 / 某节点的子节点）→ "加入并点亮"。
4. "永久删除"按钮：强警告对话框（列出影响范围）→ 确认后后端级联处理。

### Track F: 复盘页面

**文件:** `src/pages/PoliciesReview.tsx`

**任务:**
1. 事实列表：当前点亮国策、最近熄灭、最近重亮。
2. 单项历史：名称 → 当前状态 → 本轮天数 → 历史周期数 → 累计熄灭次数 → 事件时间线（加入树/点亮/熄灭/重新点亮/移除/调整父节点/重命名 + 可选原因）。
3. 不显示任何系统建议、评分、徽章、打卡入口。

### Track G: 从树移除 + 永久删除 + 撤销机制

**任务:**
1. 从树移除：带子树的节点 → 子树一起移出树 → 解除父子关系 → B/C 保留在库 → 已有周期正常结束 → 5-8s toast 撤销。
2. 永久删除：B 在树中且带子树 → 删 B → B 和 C 从树移出 → C 保留在库 → B 的周期和事件全删 → 不提供撤销但弹出强警告。
3. 撤销：前端 setTimeout 5-8s → 期内点击撤销 → 调 `undo_*` 命令回滚。

### Track H: 旧代码清理 + 页面文案统一

**任务:**
1. 删除 `src/pages/RSIP.tsx`（已被 PoliciesTree 替代）。
2. 删除 `src/features/rsip/`（布局迁移到 policies 后删除；`formulaTreeLayout.ts`→`policyTreeLayout.ts` 改名，`FormulaTreeCanvas.tsx`→`PolicyTreeCanvas.tsx` 改名，`formulaTreeGeometry.ts` 改名 `policyTreeGeometry.ts`）。
3. 全局搜索并替换 RSIP→国策、formula→policy（文案层面）。

### Track I: 新建国策流程 + 国策树选择器

**任务:**
1. 从树页面点击"+ 添加国策" → 弹出库选择器（已有国策列表 + "创建新国策"内联表单）。
2. 选择后 → 选择添加位置（根节点 / 某节点的子节点）→ 确认后自动布局并 reveal。
3. 直接创建国策（不进树）→ 仅写入 `policies` 表，状态为"未加入"。

### Track J: 完整验证 + 更新日志

**任务:**
1. `npm run check` + `npm run build` + `cargo test`。
2. 手工验收 15 项清单。
3. 更新 `CHANGELOG.md` v1.0.0 条目。
4. 更新 `docs/PRODUCT_SPEC.md`。

---

## 执行顺序与依赖

```
Phase 1（并行）: Track A（数据模型+后端）+ Track B（路由+Provider壳）
Phase 2（并行）: Track C（画布）+ Track D（详情+点亮熄灭）+ Track E（国策库）+ Track F（复盘）
Phase 3（并行）: Track G（移除删除撤销）+ Track I（新建流程）
Phase 4: Track H（旧代码清理）
Phase 5: Track J（验证）
```

Tracks C/D/E/F 都依赖 A（数据接口）和 B（路由容器），但 C-D-E-F 之间互不依赖，可并行。Track G/I 依赖 A+B+C（交互需要画布+后端）。Track H 必须在 C/D 迁移完成后执行（确保新代码已就绪再删旧代码）。
