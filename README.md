# Protocol

基于 CTDP（Chain Time-Delay Protocol）方法论的自控协议桌面应用。

## 技术栈

- **桌面框架**：Tauri 2
- **前端**：React 19 + TypeScript + Vite
- **数据库**：SQLite (rusqlite)
- **样式**：CSS 自定义（无第三方 UI 库）

## 开发

### 前置条件

- Node.js + npm
- Rust 工具链 (MSVC)
- Microsoft Visual C++ Build Tools

### 命令

```bash
npm install          # 安装前端依赖
npm run dev          # 前端开发（浏览器预览）
npm run tauri dev    # Tauri 桌面应用开发
npm run build        # 前端构建
npm run tauri build  # Tauri 打包
```

### 项目结构

```
src/
├── components/       # 共享组件（Sidebar）
├── features/ctdp/    # CTDP 业务组件
├── lib/db/           # 数据库调用 + Schema 文档
├── pages/            # 页面组件
├── styles/           # 全局样式
└── types/            # TypeScript 类型定义
src-tauri/
├── src/              # Rust 源码（db, lib, main）
├── Cargo.toml
└── tauri.conf.json
```

## V1 功能

- 主链管理（创建、列表、详情、判例库）
- 正式任务执行（倒计时、完成、中途失败裁决）
- 预约启动（倒计时、到期履约、失败裁决）
- 全局活跃协议互斥
- Dashboard 首页（统计 + 活跃状态 + 最近活动）
- 历史记录（统一事件流 + 类型/结果/主链筛选）
- 可编辑默认设置
- 明/暗主题（跟随系统）
