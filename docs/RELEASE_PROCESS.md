# 发布流程（Release Process）

本文档说明 Protocol 的版本发布检查、打包与回滚流程。

> **重要原则：正式发布安装包必须在所有目标分支合并后的 master 分支上构建，不得在任意 feature 分支上构建。**

---

## 1. 发布前检查清单

每次发布前，在 **master 分支**（所有目标 feature 已合并后）按顺序执行以下检查：

### 1.1 版本号一致性

确认以下文件中的版本号一致：

| 文件 | 字段 |
|------|------|
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/tauri.conf.json` | `version` |
| `README.md` | 版本号描述 |

```bash
# 快速检查命令（Windows PowerShell）
Select-String '"version"' package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
```

### 1.2 代码质量检查

```bash
# 轻量检查（TypeScript 类型 + ESLint）
npm run check

# 完整检查（类型 + 构建 + Rust 编译）
npm run check:full

# Rust 测试
cd src-tauri
cargo test
cd ..
```

`npm run check` 和 `npm run check:full` 的区别：

| 命令 | 包含 | 耗时 | 适用场景 |
|------|------|------|----------|
| `npm run typecheck` | 仅 TypeScript 类型检查 | 快 | 开发中频繁使用 |
| `npm run check` | typecheck + ESLint | 较快 | 提交前检查 |
| `npm run check:full` | typecheck + build + cargo check | 较慢 | 合并前 / 发布前 |

### 1.3 前端构建

```bash
npm run build
```

确保 `dist/` 目录生成成功，无报错。

### 1.4 Rust 测试

```bash
cd src-tauri
cargo test
cd ..
```

### 1.5 手动冒烟测试

参照 [`docs/QA_CHECKLIST.md`](QA_CHECKLIST.md)：
- **提交前**：完成 Must-run smoke test（约 10 分钟）
- **发布前**：完成 Full QA checklist

### 1.6 CHANGELOG 更新

确保 [`CHANGELOG.md`](../CHANGELOG.md) 已记录当前版本的：
- 功能摘要
- 已完成能力（标注归属：M 已在 master / R 本分支新增）
- 已知限制
- 后续方向

---

## 2. 打包

### 2.1 构建位置要求

**正式安装包必须在 master 分支构建。** 构建前确认：

```bash
# 1. 确认在 master 分支
git checkout master

# 2. 确认所有目标 feature 分支已合并
git log --oneline -5

# 3. 确认工作区干净
git status
```

### 2.2 构建 Windows 安装包

```bash
npm install
npm run tauri build
```

### 2.3 安装包路径

构建产物位于 `src-tauri/target/release/bundle/`：

```
src-tauri/target/release/bundle/
├── msi/
│   └── Protocol_<version>_x64_en-US.msi       # Windows MSI 安装包
└── nsis/
    └── Protocol_<version>_x64-setup.exe        # NSIS 安装包（如已配置）
```

`src-tauri/target/release/` 下还会生成独立的 `.exe` 可执行文件。

### 2.4 构建 macOS / Linux 包

当前主要目标是 Windows。如需构建其他平台：

```bash
# macOS
npm run tauri build -- --target universal-apple-darwin

# Linux (AppImage / deb)
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

---

## 3. 数据库兼容性

### 3.1 发布前备份数据库

**备份是必须步骤，无论 schema 是否变化。**

备份方式（按优先级）：

1. **若 `feature/data-management` 分支已合并到 master**：使用应用内的「数据管理」页面进行备份操作
2. **若数据管理模块尚未合并**：手动复制数据库文件到安全位置

```bash
# 手动备份（Windows PowerShell）
Copy-Item "$env:APPDATA\com.kellengo.protocol\protocol.db" "$env:USERPROFILE\Desktop\protocol.db.backup"
```

### 3.2 确认 schema 兼容性

1. 发布前备份 `protocol.db`
2. 项目的数据库迁移代码位于 `src-tauri/src/db.rs`
3. 迁移机制：每个新列通过 `add_column_if_missing()` 函数添加，带默认值
4. 已有 `migrate_precedents_to_core_schema()` 处理表结构变更
5. 在发布前应**用旧版本数据库文件启动新版本应用**，确认正常

```bash
# 1. 备份当前数据库
# 2. 启动新版本应用
npm run tauri dev
# 3. 确认应用正常启动，Dashboard 数据完整
# 4. 如启动失败，检查 db.rs 中的迁移代码
```

### 3.3 数据库文件位置

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\com.kellengo.protocol\protocol.db` |
| macOS | `~/Library/Application Support/com.kellengo.protocol/protocol.db` |
| Linux | `~/.local/share/com.kellengo.protocol/protocol.db` |

---

## 4. 回滚

### 4.1 回滚到上一 Git 版本

```bash
# 查看提交历史
git log --oneline -10

# 在 master 上回滚（保留历史）
git revert <有问题版本的commit范围>

# 或直接 checkout 到上一版本 tag
git checkout v0.2.1
```

### 4.2 数据库回滚兼容性

数据库 schema 迁移是向前兼容的（新列带默认值），因此：

- 用旧版本应用打开新版数据库**通常可以正常工作**（新列有默认值）
- 但需注意：如果新版本新增了表，旧版本不会使用这些表，数据不会丢失
- **最安全的做法**：在升级前备份 `protocol.db`

### 4.3 紧急回滚步骤

```bash
# 1. 备份当前数据库文件
# 2. 切换到上一个稳定版本 tag
git checkout <上一个版本tag>

# 3. 重新构建
npm install
npm run tauri build

# 4. 安装旧版本，如有需要则恢复备份的数据库
```

---

## 5. 发布后验证

- [ ] 安装包可以正常安装
- [ ] 安装后应用可以正常启动
- [ ] 新数据库自动创建
- [ ] 主链创建和任务流程正常
- [ ] 辅助链流程正常
- [ ] RSIP 定式树正常
- [ ] Dashboard / History / Settings 正常

---

## 6. Git 工作流

```bash
# 1. 在 feature 分支完成开发
git checkout feature/release-quality
# ... 开发、提交、推送 ...

# 2. 创建 PR 合并到 master
# （通过 GitHub PR 界面操作）

# 3. 切换到合并后的 master
git checkout master
git pull origin master

# 4. 在 master 上执行发布前检查
npm run check:full
cargo test  # in src-tauri

# 5. 在 master 上构建正式安装包
npm run tauri build

# 6. 安装包在 src-tauri/target/release/bundle/ 下
```
