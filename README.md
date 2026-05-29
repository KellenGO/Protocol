# Protocol

这是一个基于知乎文章《如何提高自制力？》（https://www.zhihu.com/question/64688680）实现的app

Protocol 是一个离线优先的桌面应用，用来把自制力规则转化为明确、可执行、可复盘的协议。

它目前包含两套核心机制：

- **CTDP，链式延时协议（Chain Time-Delay Protocol）**：围绕主链和预约链展开，用于启动正式专注、裁定失败、保留严格的协议边界。
- **RSIP，递归稳定迭代协议（Recursive Stable Iteration Protocol）**：围绕长期稳定规则建立公式树，支持激活、停用、事件历史和递归回滚。

当前版本是 **V2 Beta**。CTDP V1 和 RSIP V2 Alpha 已经完成基础能力；V2 Beta 主要强化失败、裁定、先例和协议历史相关的流程。

## 当前版本

**版本号：** `v0.2.1`

V2 Beta 的重点是让“失败 -> 裁定 -> 违规 / 先例 -> 历史复盘”这条路径更清晰、更轻量。

主要变化：

- 主链失败后会进入待裁定状态，而不是继续推进全局倒计时。
- 预约违约裁定会同步全局活跃会话按钮状态。
- 裁定表单简化为一个行为类型和两个明确结果。
- 移除了活跃业务逻辑中过重的先例字段。
- 现有先例记录会通过兼容的 SQLite 迁移保留核心数据。
- 历史页会使用协议语言展示 CTDP 和 RSIP 事件。
- V2 文档已按当前 V2 Beta 方向重新整理。

## 功能

### CTDP

- 创建和管理主链。
- 使用每条链的“圣座”标记作为正式专注会话的可见触发标签。
- 完成专注会话并延长链长。
- 会话失败后进入正式裁定。
- 将失败判定为违规，并中断主链。
- 将有争议的行为转化为先例，以保留链的边界。
- 创建预约会话，并将其兑现为正式专注会话。
- 裁定预约违约，或将其转化为预约先例。
- 在历史页复盘主链、预约链和先例相关事件。

### RSIP

- 创建根公式和子公式。
- 激活和停用公式。
- 停用父公式时，递归回滚活跃的子公式。
- 在统一历史页记录 RSIP 事件。
- 在仪表盘展示 RSIP 汇总数据。

### 桌面应用

- 基于 Tauri 2 的桌面外壳。
- React + TypeScript 前端。
- 本地 SQLite 存储。
- 不依赖云端服务。
- 不需要账号系统。
- 不使用第三方 UI 框架。

## 项目状态

Protocol 不是通用番茄钟、待办清单、习惯打卡工具，也不是游戏化效率应用。

当前开发线：

- **已完成：** CTDP V1 最小日常使用闭环。
- **已完成：** V2 Alpha RSIP 公式树。
- **当前：** V2 Beta 轻量裁定和协议边界。
- **下一步：** V2 Gamma 预约链增强、第二预约信号、RSIP 复盘改进、UI 一致性和打包发布。

更多细节见文档：

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)
- [`docs/PROTOCOL_V2_CURRENT.md`](docs/PROTOCOL_V2_CURRENT.md)
- [`docs/PROTOCOL_V2_BETA_REPORT.md`](docs/PROTOCOL_V2_BETA_REPORT.md)
- [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md)

历史规划文档保存在 [`docs/archive`](docs/archive)。

## 开发

### 环境要求

- Node.js 和 npm
- Rust 工具链
- Windows 上需要 Microsoft Visual C++ Build Tools

### 安装依赖

```bash
npm install
```

### 只运行前端

```bash
npm run dev
```

### 运行桌面应用

```bash
npm run tauri dev
```

### 构建前端

```bash
npm run build
```

### 检查 Rust 侧代码

```bash
cd src-tauri
cargo check
```

### 构建桌面安装包

```bash
npm run tauri build
```

## 仓库结构

```text
src/
  components/        共享 React 组件
  lib/db/            前端命令封装
  pages/             应用页面
  styles/            全局 CSS
  types/             TypeScript 类型
src-tauri/
  src/               Rust 命令、数据库初始化和应用入口
  tauri.conf.json    桌面应用配置
docs/
  archive/           历史规划文档
```

## 发布说明

这个仓库目前发布早期 Windows 桌面构建。应用通过 SQLite 在本地存储数据，现阶段更适合作为 alpha / beta 阶段的个人工具，而不是生产级软件。
