# Protocol V1 实施计划（V1_IMPLEMENTATION_PLAN）

## 1. V1 的开发目标

V1 的目标不是完成整套 CTDP + RSIP，而是完成一个**能够真实日常使用的 CTDP 最小闭环**。

用户应当可以：

1. 创建一条主链
2. 发起预约启动
3. 到时进入正式任务
4. 完成任务后延续链条
5. 失败时执行正式判定
6. 查看链、判例与历史

当这六件事顺畅成立时，V1 即可视为成功。

---

## 2. 推荐技术栈

- 桌面框架：Tauri 2
- 前端：React + TypeScript + Vite
- 本地数据库：SQLite
- 状态管理：先用轻量方案，避免过度设计
- 样式：先使用轻量、自定义组件体系；是否引入 UI 库可在初始化时再确认

---

## 3. 建议页面结构

### 3.1 Dashboard

功能：

- 展示关键统计
- 提供最常用入口

内容：

- 主链总数
- 当前最长链
- 今日完成正式任务数
- 最近一次任务
- 最近一次预约
- 快捷入口：
  - 预约启动
  - 新建主链

### 3.2 CTDP 链列表页

功能：

- 展示所有主链
- 新建主链
- 进入链详情

单条链卡片建议展示：

- 链名称
- 当前长度
- 历史最佳长度
- 默认任务时长
- 最近一次使用时间

### 3.3 链详情页

功能：

- 查看当前链详情
- 启动正式任务
- 查看链历史
- 查看判例库

建议区域：

1. 链概览
2. 当前状态
3. 操作按钮
4. 判例列表
5. 最近任务记录

### 3.4 预约启动页

功能：

- 选择目标链
- 发起预约
- 查看当前预约是否进行中

建议内容：

- 链选择器
- 预约时长
- 开始预约按钮
- 当前预约倒计时

### 3.5 任务执行页 / 执行面板

功能：

- 展示正式任务倒计时
- 展示当前链信息
- 完成 / 中途失败操作

这是 V1 的核心体验页。

### 3.6 判定弹窗 / 判定页

当发生失败或争议时出现。

分为两类：

1. 主链任务失败判定
2. 预约未履约判定

都提供两种决策：

- 判定失败，执行对应后果
- 判例化当前情形，填写判例内容

### 3.7 历史记录页

展示：

- 正式任务历史
- 预约历史
- 成功 / 失败 / 判例化状态
- 可按链筛选

### 3.8 RSIP 占位页

只写清楚：

- RSIP 模块将用于构建长期稳态系统
- 当前版本尚未开放

### 3.9 设置页

V1 可包含：

- 默认预约时长
- 默认任务时长
- 是否开启桌面通知（如果第一阶段能顺手做，否则留空）

---

## 4. 核心数据模型建议

### 4.1 chains

用于记录主链。

建议字段：

- id
- name
- description
- focus_duration_minutes
- current_length
- best_length
- status
- created_at
- updated_at

### 4.2 focus_sessions

记录每一次正式任务。

建议字段：

- id
- chain_id
- started_at
- expected_end_at
- ended_at
- duration_minutes
- result
  - completed
  - failed_reset
  - failed_precedent
- failure_note
- created_at

### 4.3 reservation_sessions

记录每一次预约启动。

建议字段：

- id
- chain_id
- created_at
- due_at
- fulfilled_at
- result
  - fulfilled
  - failed_reset
  - failed_precedent
- failure_note

### 4.4 precedents

记录判例。

建议字段：

- id
- chain_id
- scope
  - main_chain
  - reservation_chain
- title
- description
- created_from_session_id
- created_from_session_type
  - focus
  - reservation
- created_at

### 4.5 app_settings

记录全局设置。

建议字段：

- key
- value

---

## 5. 关键业务规则

### 5.1 主链成功

当正式任务完成后：

- focus_sessions 写入 completed
- chains.current_length += 1
- 若超过 best_length，则同步更新 best_length

### 5.2 主链失败并清零

当用户选择“判定违规”后：

- focus_sessions 写入 failed_reset
- chains.current_length = 0

### 5.3 主链失败但判例化

当用户选择“判例化”后：

- focus_sessions 写入 failed_precedent
- chains.current_length 不清零
- precedents 新增一条 main_chain 判例

### 5.4 预约履约

当预约倒计时结束后，用户进入正式任务：

- reservation_sessions 写入 fulfilled
- 随后创建 focus_session

### 5.5 预约失败并清算

当预约到期未履约，用户选择“预约失败”：

- reservation_sessions 写入 failed_reset
- V1 中可以先只记录失败，不额外维护单独的预约链长度

> 注：文章理论中辅助链本身也具有链式价值。V1 为避免复杂度，可以先实现“预约违约记录 + 判定机制”，暂不实现独立预约链计数。后续版本再补真正的辅助链长度与链断裂逻辑。

### 5.6 预约失败但判例化

当用户选择“判例化”后：

- reservation_sessions 写入 failed_precedent
- precedents 新增 reservation_chain 判例

---

## 6. V1 中值得延后讨论的产品分歧

### 6.1 是否从第一版就实现“预约链长度”

文章理论里辅助链也是一条独立链。

但 V1 可选择：

- **轻量方案**：只记录预约是否履约，不维护预约链长度
- **完整方案**：主链与预约链都维护当前长度、最佳长度

建议第一版先走轻量方案，以尽快打通产品主闭环。

### 6.2 “失败但判例化”是否应该算任务完成

文章逻辑中，这不是“任务成功”，而是“规则边界被正式调整”。

因此建议：

- 不计入完成次数
- 不增加链长度
- 但也不清零

### 6.3 正式任务进行中是否允许主动中断

建议允许主动点击“中途失败”，但不能直接静默退出。必须进入判定界面。

### 6.4 链条是否可以手动修改长度

建议 V1 不允许手动改长度。

---

## 7. 开发顺序建议

### Milestone 0：工程初始化

- 建立 Tauri + React + TypeScript 项目
- 建立基础路由
- 建立 SQLite 连接
- 创建数据库 schema
- 创建页面骨架

### Milestone 1：主链管理

- 新建主链
- 主链列表
- 链详情基础展示

### Milestone 2：正式任务执行

- 开始任务
- 任务倒计时
- 完成任务
- 链长度更新

### Milestone 3：失败判定与判例

- 失败判定弹窗
- 清零逻辑
- 判例化逻辑
- 判例列表展示

### Milestone 4：预约启动

- 预约创建
- 预约倒计时
- 到期履约进入正式任务
- 预约失败判定

### Milestone 5：Dashboard 与历史页

- 聚合统计
- 历史记录查询
- 首页信息展示

### Milestone 6：体验打磨

- 空状态
- 异常状态
- 基础视觉统一
- 文案统一

---

## 8. 给 Claude Code 的执行原则

后续 CC 执行编码任务时，应遵循：

1. 不自行改动产品逻辑
2. 不凭空扩张需求
3. 每一轮只实现明确指定的一块
4. 开始前先阅读相关文档和现有代码
5. 完成后运行构建 / 类型检查 / 测试
6. 最后汇报：
   - 修改了哪些文件
   - 实现了什么
   - 如何验证
   - 还存在哪些未完成部分

---

## 9. 第一轮交给 CC 的开发任务，应当是什么

建议不是让它一次性实现整个 V1，  
而是先做：

> **Milestone 0：工程初始化 + 文档落盘 + 空页面骨架 + SQLite schema**

等骨架稳定后，再按 Milestone 1、2、3……逐步推进。
# Historical Note

This is a historical implementation document for Protocol V1. It is preserved for project memory and should no longer be used as the current development priority. Current development should follow `docs/PROTOCOL_V2_CURRENT.md` and `docs/NEXT_STEPS.md`.
