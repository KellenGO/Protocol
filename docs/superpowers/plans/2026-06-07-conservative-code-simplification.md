# Conservative Code Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unused dependencies and direct plugin initialization while preserving all current Protocol functionality.

**Architecture:** This is a dependency-first cleanup. The React/Tauri route structure, database schema, command API, and page behavior stay unchanged; only proven-unused dependency declarations and their direct initialization are removed.

**Tech Stack:** React, TypeScript, Vite, Tauri 2, Rust, Cargo, npm.

---

## File Map

- Modify `package.json`: remove unused frontend dependencies after proving no source imports exist.
- Modify `package-lock.json`: let `npm.cmd uninstall` update dependency lock data.
- Modify `src-tauri/Cargo.toml`: remove unused Rust shell plugin dependency.
- Modify `src-tauri/Cargo.lock`: let Cargo update the dependency graph during verification.
- Modify `src-tauri/src/lib.rs`: remove the direct shell plugin initialization line only.
- Modify `src-tauri/capabilities/default.json`: remove the shell permission that only exists for the removed plugin.
- Modify `src-tauri/gen/schemas/capabilities.json`: keep the generated capability snapshot aligned with `default.json`.
- Modify `src-tauri/gen/schemas/acl-manifests.json`: accept Tauri's generated removal of shell plugin ACL metadata.
- Modify `src-tauri/gen/schemas/desktop-schema.json`: accept Tauri's generated removal of shell plugin permission schema entries.
- Modify `src-tauri/gen/schemas/windows-schema.json`: accept Tauri's generated removal of shell plugin permission schema entries.

## Task 1: Prove Cleanup Candidates Are Unused

**Files:**
- Inspect: `package.json`
- Inspect: `src-tauri/Cargo.toml`
- Inspect: `src-tauri/src/lib.rs`
- Inspect: `src-tauri/capabilities/default.json`
- Inspect: `src-tauri/gen/schemas/capabilities.json`
- Inspect: `src-tauri/tauri.conf.json`
- Inspect: `src/**`

- [ ] **Step 1: Search frontend source for Recharts usage**

Run:

```powershell
rg -n "from 'recharts'|from \"recharts\"|ResponsiveContainer|PieChart|LineChart|BarChart|AreaChart|XAxis|YAxis|Cell|Tooltip|Legend" src package.json
```

Expected: only `package.json` references `recharts`, or no source references at all.

- [ ] **Step 2: Search frontend source for shell plugin usage**

Run:

```powershell
rg -n "@tauri-apps/plugin-shell|plugin-shell|Command|open\\(" src package.json
```

Expected: only dependency declarations or unrelated text appear; no active frontend shell plugin import is found.

- [ ] **Step 3: Search Tauri manifests and Rust source for shell permissions**

Run:

```powershell
rg -n "plugin-shell|tauri_plugin_shell|shell:" src-tauri
```

Expected: `Cargo.toml`, `Cargo.lock`, the direct `.plugin(tauri_plugin_shell::init())` initialization line, and default capability snapshots may reference shell support. No application command or frontend call path should require it.

- [ ] **Step 4: Classify shell capability references**

If `src-tauri/capabilities/default.json` or `src-tauri/gen/schemas/capabilities.json` include this permission:

```json
"shell:allow-open"
```

remove it with the Rust shell plugin. If `src-tauri/gen/schemas/windows-schema.json` or `src-tauri/gen/schemas/desktop-schema.json` still mention shell permissions only as generic generated schema examples or enum entries, do not hand-edit those large generated files unless Tauri verification requires it.

## Task 2: Remove Unused Frontend Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Remove unused npm dependencies**

Run:

```powershell
npm.cmd uninstall recharts @tauri-apps/plugin-shell
```

Expected: `package.json` no longer lists `recharts` or `@tauri-apps/plugin-shell`, and `package-lock.json` is updated by npm.

- [ ] **Step 2: Confirm removed frontend dependency names are absent from source manifests**

Run:

```powershell
rg -n "recharts|@tauri-apps/plugin-shell" package.json package-lock.json src
```

Expected: no matches.

## Task 3: Remove Unused Rust/Tauri Shell Plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/gen/schemas/capabilities.json`
- Modify: `src-tauri/gen/schemas/acl-manifests.json`
- Modify: `src-tauri/gen/schemas/desktop-schema.json`
- Modify: `src-tauri/gen/schemas/windows-schema.json`

- [ ] **Step 1: Remove the Rust shell dependency**

Edit `src-tauri/Cargo.toml` and remove this line:

```toml
tauri-plugin-shell = "2"
```

- [ ] **Step 2: Remove shell plugin initialization**

Edit `src-tauri/src/lib.rs` and remove only this builder line:

```rust
.plugin(tauri_plugin_shell::init())
```

- [ ] **Step 3: Remove shell permission from default capability**

Edit `src-tauri/capabilities/default.json` so the permissions list keeps only:

```json
[
  "core:default",
  "dialog:default",
  "notification:default"
]
```

- [ ] **Step 4: Remove shell permission from generated capability snapshot**

Edit `src-tauri/gen/schemas/capabilities.json` so the `default.permissions` array keeps only:

```json
["core:default","dialog:default","notification:default"]
```

- [ ] **Step 5: Refresh Cargo dependency graph**

Run from `src-tauri`:

```powershell
cargo check
```

Expected: Cargo succeeds and updates `Cargo.lock` if the removed plugin is no longer needed.

## Task 4: Verify the Simplification

**Files:**
- Inspect: all modified files

- [ ] **Step 1: Verify removed dependency names are not referenced**

Run:

```powershell
rg -n "recharts|@tauri-apps/plugin-shell|tauri-plugin-shell|tauri_plugin_shell|plugin-shell|shell:allow-open" package.json package-lock.json src src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src src-tauri/capabilities src-tauri/gen/schemas/capabilities.json
```

Expected: no matches in active manifests, locks, capabilities, source, or the generated capability snapshot. `desktop-schema.json` and `windows-schema.json` may still contain a generic `shell:allow-open` example in documentation text; that is not an active permission.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```powershell
npm.cmd run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run lint**

Run:

```powershell
npm.cmd run lint
```

Expected: exit code 0.

- [ ] **Step 4: Run frontend build**

Run:

```powershell
npm.cmd run build
```

Expected: exit code 0 and `dist/` is available for Tauri checks.

- [ ] **Step 5: Run Rust check after frontend build**

Run from `src-tauri`:

```powershell
cargo check
```

Expected: exit code 0.

## Task 5: Review and Commit

**Files:**
- Inspect: modified files from Tasks 2-4

- [ ] **Step 1: Review working tree**

Run:

```powershell
git status --short
git diff --stat
git diff -- package.json src-tauri/Cargo.toml src-tauri/src/lib.rs
```

Expected: only planned files changed, aside from pre-existing unrelated `.superpowers/.../state/` directories.

- [ ] **Step 2: Commit the implementation if verification passed**

Run:

```powershell
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/gen/schemas/acl-manifests.json src-tauri/gen/schemas/capabilities.json src-tauri/gen/schemas/desktop-schema.json src-tauri/gen/schemas/windows-schema.json docs/superpowers/plans/2026-06-07-conservative-code-simplification.md
git commit -m "chore: remove unused shell and chart dependencies"
```

Expected: one focused commit containing the plan and conservative cleanup.
