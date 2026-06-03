# Protocol

> 一款将 CTDP 与 RSIP 方法论软件化的离线优先桌面应用，用于帮助用户把「自控」从模糊意志问题，转化为可触发、可执行、可记录、可回滚、可迭代的协议系统。

Protocol 基于[知乎文章《如何提高自制力？》](https://www.zhihu.com/question/64688680)提出的方法论实现。

---

## Protocol 是什么

Protocol 不是一个普通的番茄钟、待办清单或习惯打卡应用。它的核心不是「提醒用户要努力」，而是**为用户建立一套能够在关键行为节点上产生约束力，并可在长期生活中递归迭代的自控协议**。

它包含两套核心机制：

- **CTDP（链式时延协议）**：围绕主链和辅助链展开，用于启动正式专注、裁定失败、保留严格的协议边界。通过「神圣座位」「下必为例」「线性时延」三项原理，将自控从意志力问题转化为协议执行问题。
- **RSIP（递归稳态迭代协议）**：围绕长期稳定规则建立定式树，支持点亮、熄灭、递归回滚与事件历史。通过「国策/定式节点」「国策树」「回滚机制」等概念，帮助用户在无外部压力的日常状态中逐步改善生活整体稳态。

---

## 当前版本状态

**master 分支版本号：** `v0.2.1`（可运行的最新稳定版）

**本分支（feature/release-quality）目标版本号：** `v0.3.0`

`v0.3.0` 定义为 **V2 Gamma 后的第一个离线桌面稳定发布版**。该版本应在所有目标分支合并到 master 后，从 master 构建正式安装包。当前 `feature/release-quality` 分支是发布准备分支，负责统一版本号、整理文档、建立质量检查流程。

| 里程碑 | 状态 |
|--------|------|
| CTDP V1（主链、预约、裁决、判例） | ✅ 已在 master |
| V2 Alpha（RSIP 定式树） | ✅ 已在 master |
| V2 Beta（轻量裁决、协议边界） | ✅ 已在 master |
| V2 Gamma（辅助链连续性、第二预约信号、RSIP 单定式复盘） | ✅ 已在 master |
| 辅助链裁决闭环 | ✅ 已在 master |
| 判例库管理（查看/编辑/废止） | ✅ 已在 master |
| RSIP 单定式维护 | ✅ 已在 master |
| 发布质量保障（文档、脚本、QA 流程） | 🔄 当前分支（待合并） |
| 数据管理（备份/恢复/导出/清理） | 🔄 feature/data-management（待合并） |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri 2 |
| 前端 | React 19 + TypeScript |
| 路由 | React Router v7 |
| 构建工具 | Vite 8 |
| 后端 | Rust |
| 数据库 | SQLite（通过 rusqlite，bundled 模式） |
| 样式 | 纯 CSS（无第三方 UI 框架） |

---

## 功能范围

### CTDP 主链系统

- 创建和管理主链，设置神圣座位触发动作、专注时长、完成条件
- 启动正式专注任务
- 完成任务 → 链长度 +1
- 任务失败 → 正式裁决（违规清零 / 判例化）
- 失败调试记录（触发动作太重、完成条件过高、时间太长等）

### CTDP 辅助链系统

- 每条主链内置辅助链配置
- 预约启动（设定延迟、确认窗口）
- 到期后进入确认窗口，可履约进入正式任务
- 确认窗口结束后进入待裁决状态（非自动失败）
- 裁决：辅助链违约清零 / 判例化
- 辅助链拥有独立的当前长度和最佳长度

### 判例库

- 主链判例与辅助链判例统一管理
- 链详情页展示协议边界（合并展示两类判例，标签区分）
- 判例可查看详情、编辑标题/描述、废止
- 废止判例保留历史记录，但不再作为活跃协议边界

### RSIP 定式树

- 创建根定式 / 子定式
- 树形缩进展示定式依赖关系
- 点亮（激活）/ 熄灭（停用）定式
- 父节点熄灭时递归回滚活跃子节点
- 定式生命周期复盘面板
- 熄灭时可填写自定义备注
- 可编辑定式标题和执行说明

### Dashboard 与 History

- Dashboard 展示 CTDP 摘要与 RSIP 摘要
- 当前协议状态指示（无活动 / 任务进行中 / 待裁决 / 预约倒计时 / 预约确认窗口）
- History 展示 CTDP + 辅助链 + RSIP 的统一协议时间线
- 支持按事件类型、结果筛选

### 设置

- 默认专注时长
- 默认预约时长
- 辅助链确认窗口时长
- 通知开关

---

## 不包含什么

Protocol 目前**不包含**以下功能，且短期内无计划加入：

- ❌ AI 建议 / 智能分析
- ❌ 云同步 / 多设备联动
- ❌ 账号系统 / 登录注册
- ❌ 手机 App（仅桌面）
- ❌ 社区分享 / 社交功能
- ❌ 积分 / 徽章 / 排行榜等游戏化元素
- ❌ 桌面通知 / 窗口置顶（后续版本可能加入）
- ❌ 复杂任务编组 / 精锐链 / 储君继承制
- ❌ 国策组容错（后续版本）
- ❌ 自动化 CI/CD 流水线

这些功能并非不重要，而是为了让 Protocol 在当前阶段保持产品边界清晰。

---

## 数据存储说明

**所有数据仅存储在本地，不会上传到任何服务器。**

- 数据库文件：系统应用数据目录下的 `protocol.db`
- 数据库引擎：SQLite（WAL 模式，外键约束开启）
- 不依赖任何云端服务
- 不需要网络连接即可正常使用

**备份方式：**
- 若 `feature/data-management` 分支已合并，请使用应用内的数据管理页面进行备份
- 若数据管理模块尚未合并，可直接复制 `protocol.db` 文件到安全位置作为手动备份

---

## 开发

### 环境要求

- **Node.js** ≥ 18（推荐 20+）和 npm
- **Rust 工具链**（通过 [rustup](https://rustup.rs/) 安装）
- **Windows**：需要 Microsoft Visual C++ Build Tools
- **macOS / Linux**：需要系统 C 编译器及相关库

### 安装依赖

```bash
npm install
```

### 开发模式运行

```bash
# 仅前端（浏览器开发）
npm run dev

# 完整桌面应用
npm run tauri dev
```

### 构建与检查

```bash
# TypeScript 类型检查 + 前端生产构建
npm run build

# 仅 TypeScript 类型检查（不构建）
npm run typecheck

# 轻量检查（类型 + ESLint）
npm run check

# 完整检查（类型 + 构建 + Rust 编译检查）
npm run check:full

# Rust 侧单独检查
cd src-tauri
cargo check

# 构建 Windows 安装包
npm run tauri build
```

### 构建 Windows 安装包

1. 确保安装了所有环境依赖（Node.js、Rust、VS Build Tools）
2. 运行 `npm install`
3. 运行 `npm run tauri build`
4. 安装包生成在 `src-tauri/target/release/bundle/` 目录下
   - `.msi` 安装包位于 `bundle/msi/`
   - 便携版 `.exe` 位于 `bundle/nsis/`（如有 NSIS 配置）

---

## 仓库结构

```text
src/
  components/        共享 React 组件
  features/          功能模块
  lib/db/            前端数据库命令封装
  pages/             应用页面
  styles/            全局 CSS
  types/             TypeScript 类型定义
src-tauri/
  src/
    db.rs            Rust 数据库初始化与迁移
    lib.rs           Rust Tauri 命令
    main.rs          应用入口
  Cargo.toml         Rust 依赖配置
  tauri.conf.json    桌面应用配置
docs/
  PRODUCT_SPEC.md    产品规格说明
  V2_ALPHA_PROTOCOL_MAP.md  V2 功能映射
  PROTOCOL_V2_CURRENT.md    当前状态文档
  QA_CHECKLIST.md    质量检查清单
  RELEASE_PROCESS.md  发布流程
  CHANGELOG.md       发布说明
  archive/           历史规划文档
```

---

## 基本故障排查

### `npm install` 失败

- 确保 Node.js 版本 ≥ 18
- 尝试删除 `node_modules` 和 `package-lock.json` 后重试
- Windows 用户确保安装了 Visual C++ Build Tools

### `npm run tauri dev` 无法启动

- 检查 Rust 是否安装：`rustc --version`
- 检查 Tauri CLI：`npx tauri --version`
- Windows：确保已安装 WebView2 运行时
- 运行 `cargo check` 查看 Rust 侧编译错误

### `npm run tauri build` 失败

- 确保先运行 `npm install`
- 检查 `src-tauri/target/` 目录权限
- Windows 打包 MSI 需要 WiX Toolset（如未安装，Tauri 会提示）
- 查看 `src-tauri/target/release/` 下的构建日志

### 数据库问题

- 数据库文件损坏：删除应用数据目录下的 `protocol.db`，重启应用会自动创建新数据库
- 应用数据目录位置：
  - Windows: `%APPDATA%/com.kellengo.protocol/`
  - macOS: `~/Library/Application Support/com.kellengo.protocol/`
  - Linux: `~/.local/share/com.kellengo.protocol/`

### 应用无法启动

- 检查是否有其他 Protocol 实例正在运行
- 尝试删除应用数据目录（注意备份 `protocol.db`）
- 查看系统日志或终端输出中的错误信息

---

## 发布说明

详见：
- [`CHANGELOG.md`](CHANGELOG.md) — 各版本功能摘要
- [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md) — 发布操作流程
- [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md) — 质量检查清单

---

## 相关文档

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — 产品规格说明
- [`docs/V2_ALPHA_PROTOCOL_MAP.md`](docs/V2_ALPHA_PROTOCOL_MAP.md) — V2 功能与理论映射
- [`docs/PROTOCOL_V2_CURRENT.md`](docs/PROTOCOL_V2_CURRENT.md) — 当前状态
- [`docs/PROTOCOL_V2_BETA_REPORT.md`](docs/PROTOCOL_V2_BETA_REPORT.md) — V2 Beta 报告
- [`docs/PROTOCOL_V2_GAMMA_REPORT.md`](docs/PROTOCOL_V2_GAMMA_REPORT.md) — V2 Gamma 报告
- [`docs/PROTOCOL_RSIP_V1_MATURITY_REPORT.md`](docs/PROTOCOL_RSIP_V1_MATURITY_REPORT.md) — RSIP 成熟度报告
- [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md) — 后续方向
- [`docs/archive/`](docs/archive/) — 历史规划文档
