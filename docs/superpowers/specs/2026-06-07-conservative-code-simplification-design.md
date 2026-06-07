# Conservative Code Simplification Design

## Goal

Reduce Protocol's maintenance and build surface while preserving all current user-visible behavior, routes, data model, and offline desktop workflow.

This is a conservative cleanup pass. It is not a product reduction, page removal, database migration, or UI redesign.

## Current Context

Protocol is a Tauri desktop app with a React/TypeScript frontend and a Rust/Rusqlite backend. The current source tree is small compared with the development build cache, but several dependency and source hotspots make the project heavier to maintain than necessary.

Observed low-risk cleanup candidates:

- `recharts` is listed in `package.json`, but current source search found no imports or chart component usage.
- `@tauri-apps/plugin-shell` is listed in `package.json`, but current frontend source search found no shell plugin import or call.
- `tauri-plugin-shell` is listed in `src-tauri/Cargo.toml` and initialized in `src-tauri/src/lib.rs`, but no command path currently needs shell behavior.
- `src/styles/global.css` and `src-tauri/src/lib.rs` are large, but splitting them would be a structural refactor. That should not be part of this first conservative pass unless dead code is proven locally.

## Scope

In scope:

- Remove unused frontend dependencies that are proven unused by source search.
- Remove unused Tauri/Rust dependencies and plugin initialization that are proven unused by source search.
- Remove tiny, local dead code only when TypeScript or Rust checks confirm it is unused and removal does not change behavior.
- Update lockfiles only as required by dependency removal.
- Run the normal build and check commands after changes.

Out of scope:

- Removing pages, routes, or product features.
- Changing CTDP, RSIP, focus, reservation, backup, restore, review, history, or settings behavior.
- Changing the SQLite schema or migrations.
- Rewriting `src-tauri/src/lib.rs` into modules.
- Splitting `src/styles/global.css`.
- Introducing new libraries, frameworks, build tools, or formatting-only churn.

## Approach

Use a narrow dependency-first simplification:

1. Prove candidate dependencies are unused with source search.
2. Remove only those unused dependencies and their direct initialization lines.
3. Let package managers update lockfiles rather than editing locks by hand where practical.
4. Re-run source search for removed package names.
5. Validate with TypeScript, frontend build, lint, and Rust checks.

This keeps the cleanup reversible and avoids touching the core product model.

## Expected Files

Likely modified:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/src/lib.rs`

Only if checks expose local dead code:

- A directly related TypeScript or Rust source file containing the dead code.

## Behavior Requirements

After simplification:

- All existing routes remain wired in `src/App.tsx`.
- All current pages remain present.
- Tauri still initializes dialog and notification plugins.
- Data export/import, notifications, tray behavior, and database commands remain available.
- No user data format or database schema changes.

## Verification

Run these commands after implementation:

- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`
- `cargo check` from `src-tauri`

Also verify by search:

- No remaining source or manifest references to `recharts` if it is removed.
- No remaining source or manifest references to `plugin-shell` or `tauri_plugin_shell` if shell support is removed.

## Risks

- Tauri template code may include shell plugin capabilities or generated files that are not obvious from normal source search. The implementation must search manifests and capability files before removing it.
- Lockfile updates can be larger than the source diff. This is acceptable only when caused by dependency removal.
- `cargo check` can depend on the frontend `dist` directory because Tauri reads `frontendDist`; run frontend build before Rust check if needed.

## Non-Goals

This pass does not try to reduce the 12GB development cache directly. That cache lives under `src-tauri/target` and can be cleaned separately without source-code changes.

This pass does not try to optimize final installer size. The current installer is already small enough that dependency cleanup is mainly about source/build hygiene, not user disk usage.
