# 发布流程（Release Process）

本文档说明 Protocol 的版本发布检查、打包与回滚流程。

---

## 1. 发布前检查清单

每次发布前，按顺序执行以下检查：

### 1.1 版本号一致性

确认以下文件中的版本号一致：

| 文件 | 字段 |
|------|------|
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/tauri.conf.json` | `version` |
| `README.md` | 版本号描述 |

```bash
# 快速检查命令
grep -n '"version"' package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
```

### 1.2 代码质量检查

```bash
# TypeScript 类型检查
npm run typecheck

# ESLint 检查
npm run lint

# 完整检查
npm run check

# Rust 侧检查
cd src-tauri
cargo check
cd ..
```

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

参照 [`docs/QA_CHECKLIST.md`](QA_CHECKLIST.md) 逐项验证。

### 1.6 CHANGELOG 更新

确保 [`CHANGELOG.md`](../CHANGELOG.md) 已记录当前版本的：
- 功能摘要
- 已完成能力
- 已知限制
- 后续方向

---

## 2. 打包

### 2.1 构建 Windows 安装包

```bash
npm run tauri build
```

### 2.2 安装包路径

构建产物位于 `src-tauri/target/release/bundle/`：

```
src-tauri/target/release/bundle/
├── msi/
│   └── Protocol_<version>_x64_zh-CN.msi    # Windows MSI 安装包
└── nsis/
    └── Protocol_<version>_x64-setup.exe      # NSIS 安装包（如已配置）
```

`src-tauri/target/release/` 下还会生成独立的 `.exe` 可执行文件。

### 2.3 构建 macOS / Linux 包

当前主要目标是 Windows。如需构建其他平台：

```bash
# macOS
npm run tauri build -- --target universal-apple-darwin

# Linux (AppImage / deb)
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

---

## 3. 数据库兼容性

### 3.1 是否需要备份数据库

**如果 schema 未变化**：不需要备份。现有 `protocol.db` 可直接使用新版本。

**如果 schema 有变化**：
1. 发布前备份 `protocol.db`（复制到安全位置）
2. 项目的数据库迁移代码位于 `src-tauri/src/db.rs`
3. 迁移机制：每个新列通过 `add_column_if_missing()` 函数添加，带默认值
4. 已有 `migrate_precedents_to_core_schema()` 处理表结构变更
5. 在发布前应在本地用旧数据库测试新版本启动

### 3.2 确认 schema 兼容性

```bash
# 1. 备份当前数据库
# Windows: 复制 %APPDATA%\com.kellengo.protocol\protocol.db

# 2. 启动新版本应用
npm run tauri dev

# 3. 确认应用正常启动，Dashboard 数据完整

# 4. 如启动失败，检查 schema 迁移代码
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

# 回滚到上一个版本（假设上一版本 tag 或 commit 为 <ref>）
git checkout <ref>

# 或使用 git revert（保留历史）
git revert <当前版本commit>..HEAD
```

### 4.2 数据库回滚兼容性

数据库 schema 迁移是向前兼容的（新列带默认值），因此：

- 用旧版本应用打开新版数据库**通常可以正常工作**（新列有默认值）
- 但需注意：如果新版本新增了表，旧版本不会使用这些表，数据不会丢失
- 最安全的做法：在升级前用文件复制方式备份 `protocol.db`

### 4.3 紧急回滚步骤

```bash
# 1. 备份当前数据库文件
cp <app_data_dir>/protocol.db <app_data_dir>/protocol.db.backup

# 2. 切换到上一个稳定版本
git checkout <上一个版本tag>

# 3. 重新构建
npm install
npm run tauri build

# 4. 安装旧版本，用备份数据库替换（如需要）
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
# 1. 确保在正确的功能分支上
git checkout feature/release-quality

# 2. 提交所有修改
git add -A
git commit -m "release: v0.3.0 发布质量基准线"

# 3. 推送到远程
git push origin feature/release-quality

# 4. 不直接合并到 master（等待 PR review）
```
