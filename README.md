# Protocol

这是一个基于知乎文章《如何提高自制力？》（https://www.zhihu.com/question/64688680）实现的app

Protocol 是一个离线优先的桌面应用，用来把自制力规则转化为明确、可执行、可复盘的协议。

它目前包含两套核心机制：

- **CTDP，链式延时协议（Chain Time-Delay Protocol）**：围绕主链和预约链展开，用于启动正式专注、裁定失败、保留严格的协议边界。
- **RSIP，递归稳定迭代协议（Recursive Stable Iteration Protocol）**：围绕长期稳定规则建立公式树，支持激活、停用、事件历史和递归回滚。

当前版本处于 **V2 Gamma 之后的闭环成熟化阶段**。CTDP V1、V2 Alpha RSIP 定式树、V2 Beta 轻量裁决和 V2 Gamma 辅助链增强已经完成基础闭环；当前主线是把辅助链裁决、判例库和 RSIP 单定式维护做成可长期使用的离线桌面能力。

## 当前版本

**版本号：** `v0.2.1`

当前阶段的重点是让“预约 -> 确认 -> 裁决 -> 违约 / 判例 -> 协议边界维护”形成闭环。

主要变化：

- 主链失败后进入轻量裁决。
- 辅助链具有独立当前长度和最佳长度。
- 辅助链到期后先进入确认窗口，确认窗口结束后进入待裁决。
- 辅助链裁决支持违约清零或判例化。
- 判例库支持详情查看、编辑和废止；废止判例保留历史但不再作为活跃边界。
- RSIP 单定式复盘支持标题 / 执行说明维护，并允许在熄灭前填写本次备注。
- 历史页使用协议语言展示 CTDP、辅助链和 RSIP 事件。
- 当前产品边界是完整离线桌面版；AI、云同步、账号系统和手机 App 暂不进入当前主线。

## 功能

### CTDP

- 创建和管理主链。
- 使用每条链的“圣座”标记作为正式专注会话的可见触发标签。
- 完成专注会话并延长链长。
- 会话失败后进入正式裁定。
- 将失败判定为违规，并中断主链。
- 将有争议的行为转化为先例，以保留链的边界。
- 创建预约会话，并将其兑现为正式专注会话。
- 辅助链到期后进入确认窗口，再进入正式裁决。
- 裁定辅助链违约并清零辅助链，或将其转化为辅助链判例。
- 查看、编辑和废止主链 / 辅助链判例。
- 在历史页复盘主链、辅助链和判例相关事件。

### RSIP

- 创建根公式和子公式。
- 激活和停用公式。
- 停用父公式时，递归回滚活跃的子公式。
- 在统一历史页记录 RSIP 事件。
- 在仪表盘展示 RSIP 汇总数据。
- 查看单个定式的生命周期、熄灭备注、回滚影响和事件历史。
- 在复盘面板中编辑定式标题和执行说明。
- 熄灭当前复盘定式时记录用户填写的熄灭备注。

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
- **已完成：** V2 Beta 轻量裁决和协议边界。
- **已完成：** V2 Gamma 辅助链长度、第二预约信号和 RSIP 单定式复盘。
- **当前：** 辅助链裁决闭环、判例库成熟化第一版和 RSIP 单定式维护第一版。
- **下一步：** RSIP 国策组 / 周期复盘、桌面通知、数据备份恢复和发布质量保障。

更多细节见文档：

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)
- [`docs/PROTOCOL_V2_CURRENT.md`](docs/PROTOCOL_V2_CURRENT.md)
- [`docs/PROTOCOL_V2_BETA_REPORT.md`](docs/PROTOCOL_V2_BETA_REPORT.md)
- [`docs/PROTOCOL_V2_GAMMA_REPORT.md`](docs/PROTOCOL_V2_GAMMA_REPORT.md)
- [`docs/PROTOCOL_RSIP_V1_MATURITY_REPORT.md`](docs/PROTOCOL_RSIP_V1_MATURITY_REPORT.md)
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
