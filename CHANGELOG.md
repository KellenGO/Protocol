# CHANGELOG

## v0.5.0（国策树无限画布与节点拖拽）

**发布日期：** 2026-08-01

**状态：** 国策树界面与结构操作完成一次大版本升级：无限画布、新自动布局与节点拖拽调整父级。

### 新增

- **无限画布**：滚轮缩放（始终围绕鼠标位置，0.3–2.4 倍）、空白区域或中键拖动平移、画布工具栏（－ / ＋ / 百分比 / 适应画布 / 定位选中节点）、首次加载自动适应画布。
- **全新自动布局**：先递归测量每棵子树宽度再放置节点，多根节点与深层不对称子树互不重叠，不再按视口宽度压缩间距；屏幕坐标始终由布局函数计算，不写入数据库（数据库只存 `parent_id` 与 `position`）。
- **节点拖拽调整父级**：拖动节点到候选父节点时金色高亮并显示虚线预览连线；拖到顶部「拖到这里，提升为根节点」区域可提升为根节点；空白处松开取消；禁止拖到自身或子孙节点（防循环）；拖动父节点时整棵子树跟随。
- **后端新增 `move_rsip_formula` 事务命令**：校验源/目标存在、递归 CTE 防循环、同名检查、旧/新兄弟节点 `position` 连续整理；移动到未点亮父节点时弹窗确认，确认后在同一事务中递归熄灭已点亮节点。
- 新建节点自动定位到可见区域并高亮约 1 秒；移动成功后节点位置 220ms 过渡动画；移动后提示重新填写依赖说明（原说明自动清空）。
- 导航与页面文案统一为「国策树」。

### 修复

- 根节点与选中节点样式不再覆盖状态灯颜色：点亮=绿灯、熄灭=灰灯，选中只表达金色边框。
- 多个无子节点的根节点间距不足导致重叠的问题。

### 数据迁移

- `formula_events` 表重建并加入 `reparented` 事件类型（旧数据自动复制保留），移动操作记录「调整父节点」事件。

### 保留行为

- 现有点亮/熄灭/递归回滚、目标转译、复盘、数据管理与备份恢复行为不变。

---

## v0.4.0 (RSIP Goal Translation)

**Release date:** 2026-06-06

**Status:** Manual RSIP goal translation slice added on top of the complete offline desktop v0.3.x baseline.

### Added

- Added `rsip_goals` for broad RSIP directions that are not directly executable.
- Added `rsip_failure_paths` for ordered behavior paths under a goal.
- Extended `rsip_formulas` with nullable `goal_id`, `failure_path_id`, `intervention_node_id`, and `dependency_note`.
- Added RSIP page goal view with active goal cards, formula counts, failure-path counts, linked paths, and linked formulas.
- Added a four-step goal translation wizard: goal -> failure path -> intervention point -> formula.
- Added backend commands and TypeScript wrappers for goals, failure paths, and goal-linked formula creation.
- Added database-info, backup-inspection, and history-export awareness for the new RSIP tables.

### Preserved

- Existing RSIP formula tree, activation, deactivation, recursive rollback, and review behavior.
- Existing CTDP main-chain, auxiliary-chain, precedent-library, History, Review, Settings, and Data Management behavior.
- Existing formulas remain valid with empty goal metadata.

### Still out of scope

- AI-generated suggestions.
- Cloud sync, accounts, mobile, and social/community features.
- Large UI framework changes.
- CTDP or auxiliary-chain business-logic rewrites.

---

本文件记录 Protocol 各版本的功能变更、已知限制与后续方向。

---

## v0.3.0（当前版本）

**发布日期：** 2026-06-03

**状态：** 所有功能模块已合并到 master 分支。v0.3.0 是 V2 Gamma 后的第一个完整离线桌面发布版。

### 新增模块

#### 桌面集成
- 系统托盘图标与菜单（支持显示/隐藏窗口、退出应用）
- 桌面通知（专注任务结束、预约到期等关键事件）
- 通知权限管理（设置页可开启/关闭、请求系统权限）
- 全局聚焦按钮（悬浮组件，提供快捷操作入口）

#### 复盘系统
- **主链复盘**：按主链汇总执行指标（完成次数、失败清零、判例化、预约履约/失败统计）
- **失败模式复盘**：按调试类别聚合失败记录，展示各类别发生次数与最近备注
- **判例复盘**：浏览全部判例，追溯关联链名与来源会话
- 时间周期筛选（7天 / 30天 / 90天 / 全部）

#### 数据管理
- 数据库信息查看（路径、文件大小、版本号、各表记录数）
- 数据库备份（导出为 SQLite 文件，使用文件保存对话框）
- 数据库恢复（从备份文件恢复，恢复前可预览备份内容）
- 历史数据 JSON 导出
- 历史记录与进度重置（保留链定义、判例库和定式树）

### CTDP 已完成能力

- 主链创建与管理（名称、神圣座位触发动作、专注时长、完成条件）
- 正式任务启动 / 完成（完成延长链长度）
- 正式任务失败裁决：违规清零 或 判例化
- 辅助链配置（内嵌于每条主链，支持触发动作、延迟、完成条件）
- 辅助链启动 / 确认窗口 / 履约进入正式任务
- 辅助链到期待裁决（非自动失败）
- 辅助链裁决：违约清零（仅辅助链清零，不影响主链长度）或辅助链判例化
- 辅助链独立当前长度和最佳长度
- 判例库管理：查看详情、编辑标题/描述、废止（保留历史但不作为活跃边界）
- 协议边界展示（主链判例与辅助链判例合并，标签区分来源）
- 轻量失败调试记录（触发动作太重、完成条件过高、时间太长、环境不适合、规则不清、状态不足、其他）
- Dashboard 协议状态指示（无活动 / 进行中 / 待裁决 / 预约倒计时 / 预约确认窗口）
- History 事件时间线（CTDP + 辅助链 + 判例事件）

### RSIP 已完成能力

- 定式节点创建（根定式 / 子定式）
- 定式树缩进展示
- 定式点亮（激活）/ 熄灭（停用）
- 父节点熄灭时递归回滚活跃子节点
- formula_events 事件日志
- Dashboard RSIP 摘要（总数 / 活跃数 / 非活跃数 / 最新事件）
- History 统一协议时间线（CTDP + 辅助链 + RSIP 事件）
- 单定式复盘面板：生命周期、熄灭备注、回滚影响、事件历史
- 定式标题和执行说明编辑
- 熄灭时用户自定义备注

### 基础架构

- Tauri 2 桌面外壳
- React 19 + TypeScript 前端
- Rust 后端（rusqlite bundled SQLite）
- 本地 SQLite 存储（WAL 模式，外键约束）
- 离线优先，无云端依赖
- 数据库迁移框架
- TypeScript 类型检查 + ESLint
- npm scripts：typecheck / build / check / check:full
- Rust 单元测试
- tauri-plugin-notification（桌面通知）
- tauri-plugin-dialog（文件对话框）
- tauri-plugin-shell（打开外部链接）

### 发布质量

- CHANGELOG.md（本文件）
- docs/QA_CHECKLIST.md（冒烟测试清单）
- docs/RELEASE_PROCESS.md（发布检查、打包、回滚流程）
- docs/DESKTOP_INTEGRATION.md（桌面集成说明）
- 版本号统一为 0.3.0（package.json / Cargo.toml / tauri.conf.json）

### 当前已知限制

- 不包含 RSIP 国策组容错
- 不包含水密隔舱
- 不包含 RSIP 定式向导
- 不包含 RSIP 周期复盘
- 不包含多语言支持（仅中文界面）
- 不包含自动化 CI/CD 流水线
- 安装包签名待配置

### 后续方向

- RSIP 国策组容错
- RSIP 周期复盘
- 安装包签名
- Windows / macOS / Linux 三平台正式构建验证

---

## v0.2.1（V2 Gamma）

**此版本已在 master 分支。**

### 主要变化

- V2 Gamma 完成：辅助链独立长度、第二预约信号、RSIP 单定式复盘
- 辅助链裁决闭环（确认窗口到期 → 待裁决 → 违约清零或判例化）
- 判例库成熟化第一版（查看详情、编辑、废止，保留历史）
- RSIP 单定式维护第一版（标题/说明编辑、自定义熄灭备注）
- History 页使用协议语言展示 CTDP、辅助链和 RSIP 事件
- 当前产品边界是完整离线桌面版

---

## v0.2.0（V2 Alpha）

**此版本已在 master 分支。**

### 主要变化

- RSIP 定式树接入 Dashboard 和 History
- 定式节点、父子结构、点亮/熄灭、递归回滚、事件日志
- CTDP 主链和预约链基础功能
- 最小可用离线桌面版本

---

## v0.1.0（CTDP V1）

**此版本已在 master 分支。**

### 初始版本

- 主链创建与管理
- 正式任务启动/完成
- 预约启动机制
- 基础判例库
- Dashboard 和 History 基础展示
