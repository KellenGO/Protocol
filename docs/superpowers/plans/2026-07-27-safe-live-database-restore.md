# Safe Live Database Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unsafe open-file database overwrite with a validated, rollback-safe SQLite Online Backup restore that becomes active through the existing managed connection.

**Architecture:** Open user backups read-only, copy them into an isolated staging database, reuse the current schema initializer and migrations there, and validate the result before touching live data. Hold the existing `Mutex<Connection>` while creating a safety snapshot and copying staging into the live connection; unfinished SQLite backup operations roll back, and a post-copy validation failure restores the safety snapshot.

**Tech Stack:** Rust 2021, Tauri 2, rusqlite 0.31 with existing `bundled` plus `backup` features, bundled SQLite, React 19, TypeScript, Node test runner.

## Global Constraints

- Do not add a crate, npm package, framework, service, or database migration.
- Keep `Database { conn: Mutex<Connection>, db_path: PathBuf }`; do not update the existing command call sites to an optional or replaceable connection.
- Never overwrite, delete, rename, or unlink an open `protocol.db`.
- Never mutate the user-selected backup during inspection or restore.
- Accept only self-contained Protocol SQLite backups as restore sources; reject active WAL databases and sidecar sets before opening them.
- A failure before the live copy must leave live untouched; an unfinished live copy must roll back; a failed post-copy validation must restore the safety snapshot.
- Keep the existing `restore_database` IPC name and `Promise<string>` frontend wrapper.
- Accept old backups through the existing migrations; reject `user_version > 1`.
- Reject an online restore when source and live page sizes differ.
- Keep every pre-restore safety snapshot; clean only task-owned staging files and sidecars.
- Treat Windows behavior as a release requirement.

---

## File Map

- Modify `src-tauri/Cargo.toml`: enable rusqlite's existing `backup` feature.
- Modify `src-tauri/src/db.rs`: expose current DB version and extract the connection-based schema initializer.
- Modify `src-tauri/src/lib.rs`: read-only inspection, validation, staging, Online Backup copy, safety snapshot, restore orchestration, and Tauri command.
- Create `src-tauri/src/restore_tests.rs`: focused filesystem-backed restore tests using standard-library temporary directories.
- Modify `src/pages/DataManagement.tsx`: immediate-success semantics, refresh, and accurate confirmation copy.
- Modify `README.md`: distinguish online restore from unsafe manual copying.
- Modify `docs/PRODUCT_SPEC.md`: record validation, safety snapshot, and immediate activation.
- Modify `docs/QA_CHECKLIST.md`: add Windows restore round-trip and failure-safety checks.

## Task 1: Make Backup Inspection Read-Only and Trustworthy

**Files:**

- Modify: `src-tauri/src/db.rs:1-30`
- Modify: `src-tauri/src/lib.rs:2841-2962`
- Create: `src-tauri/src/restore_tests.rs`
- Modify: `src-tauri/src/lib.rs:3344` to register `#[cfg(test)] mod restore_tests;`

**Interfaces:**

- Consumes: existing `REQUIRED_TABLES`, `RSIP_TABLES`, `BackupFileInfo` JSON shape, and `Database::new`.
- Produces:
  - `pub(crate) const CURRENT_DB_VERSION: i64 = 1`
  - `fn validate_backup_sidecar_state(path: &Path) -> Result<(), String>`
  - `fn open_backup_read_only(path: &Path) -> Result<Connection, String>`
  - `fn check_database_integrity(conn: &Connection) -> Result<(), String>`
  - `fn table_exists(conn: &Connection, table: &str) -> Result<bool, String>`
  - `fn validate_backup_source(conn: &Connection) -> Result<(), String>`
  - a non-mutating `inspect_backup_file`

- [ ] **Step 1: Add the focused test module and deterministic temporary-directory fixture**

Add this module declaration next to the existing `#[cfg(test)] mod tests` declaration in `src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod restore_tests;
```

Create `src-tauri/src/restore_tests.rs` with this standard-library fixture:

```rust
use super::*;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

struct RestoreTestDir {
    path: PathBuf,
}

impl RestoreTestDir {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let counter = TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "protocol-restore-{label}-{}-{nonce}-{counter}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for RestoreTestDir {
    fn drop(&mut self) {
        if self.path.starts_with(std::env::temp_dir()) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn create_protocol_database(root: &Path) -> PathBuf {
    let app_dir = root.join("app");
    let database = Database::new(app_dir.clone()).unwrap();
    drop(database);
    app_dir.join("protocol.db")
}

fn create_protocol_backup(root: &Path) -> PathBuf {
    let app_dir = root.join("source-app");
    let database = Database::new(app_dir).unwrap();
    let backup_path = root.join("backup.sqlite");
    let escaped = backup_path.to_string_lossy().replace('\'', "''");
    database
        .conn
        .lock()
        .unwrap()
        .execute_batch(&format!("VACUUM INTO '{escaped}';"))
        .unwrap();
    drop(database);
    backup_path
}

fn sidecar_path(database_path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{}", database_path.display(), suffix))
}
```

- [ ] **Step 2: Write failing read-only inspection tests**

Append these tests to `restore_tests.rs`:

```rust
#[test]
fn inspect_valid_backup_is_read_only() {
    let test_dir = RestoreTestDir::new("inspect-read-only");
    let backup_path = create_protocol_backup(test_dir.path());
    let before = std::fs::read(&backup_path).unwrap();

    let info = inspect_backup_file(backup_path.to_string_lossy().to_string()).unwrap();

    assert_eq!(info["version"].as_i64(), Some(CURRENT_DB_VERSION));
    assert_eq!(std::fs::read(&backup_path).unwrap(), before);
    for suffix in ["-wal", "-shm", "-journal"] {
        assert!(!sidecar_path(&backup_path, suffix).exists());
    }
}

#[test]
fn inspect_rejects_corrupt_database_instead_of_reporting_zero_counts() {
    let test_dir = RestoreTestDir::new("inspect-corrupt");
    let path = test_dir.path().join("corrupt.sqlite");
    std::fs::write(&path, vec![b'x'; 8192]).unwrap();

    let error = inspect_backup_file(path.to_string_lossy().to_string()).unwrap_err();

    assert!(error.contains("SQLite") || error.contains("完整性"));
}

#[test]
fn inspect_rejects_database_missing_a_core_table() {
    let test_dir = RestoreTestDir::new("inspect-missing-table");
    let path = test_dir.path().join("foreign.sqlite");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE chains (id INTEGER PRIMARY KEY);
         CREATE TABLE focus_sessions (id INTEGER PRIMARY KEY);
         CREATE TABLE reservation_sessions (id INTEGER PRIMARY KEY);
         CREATE TABLE precedents (id INTEGER PRIMARY KEY);
         VACUUM;",
    )
    .unwrap();
    drop(conn);

    let error = inspect_backup_file(path.to_string_lossy().to_string()).unwrap_err();

    assert!(error.contains("app_settings"));
}

#[test]
fn inspect_rejects_newer_database_version() {
    let test_dir = RestoreTestDir::new("inspect-newer");
    let path = create_protocol_backup(test_dir.path());
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "user_version", CURRENT_DB_VERSION + 1)
        .unwrap();
    drop(conn);

    let error = inspect_backup_file(path.to_string_lossy().to_string()).unwrap_err();

    assert!(error.contains("版本"));
    assert!(error.contains(&(CURRENT_DB_VERSION + 1).to_string()));
}

#[test]
fn inspect_rejects_active_wal_database_without_touching_sidecars() {
    let test_dir = RestoreTestDir::new("inspect-active-wal");
    let app_dir = test_dir.path().join("active-app");
    let database = Database::new(app_dir.clone()).unwrap();
    database
        .conn
        .lock()
        .unwrap()
        .execute("INSERT INTO chains (name) VALUES ('wal-live')", [])
        .unwrap();
    let path = app_dir.join("protocol.db");
    let wal_path = sidecar_path(&path, "-wal");
    let shm_path = sidecar_path(&path, "-shm");
    let main_before = std::fs::read(&path).unwrap();
    let wal_before = std::fs::read(&wal_path).unwrap();
    let shm_before = std::fs::read(&shm_path).unwrap();

    let error = inspect_backup_file(path.to_string_lossy().to_string()).unwrap_err();

    assert!(error.contains("活动 WAL"));
    assert_eq!(std::fs::read(&path).unwrap(), main_before);
    assert_eq!(std::fs::read(&wal_path).unwrap(), wal_before);
    assert_eq!(std::fs::read(&shm_path).unwrap(), shm_before);
}

#[test]
fn inspect_rejects_truncated_sqlite_database() {
    let test_dir = RestoreTestDir::new("inspect-truncated");
    let path = create_protocol_backup(test_dir.path());
    let original_len = std::fs::metadata(&path).unwrap().len();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(original_len / 2)
        .unwrap();

    let error = inspect_backup_file(path.to_string_lossy().to_string()).unwrap_err();

    assert!(error.contains("SQLite") || error.contains("完整性"));
}
```

- [ ] **Step 3: Run the targeted tests and confirm RED**

Run:

```powershell
cargo test --locked restore_tests::inspect_ -- --nocapture
```

Working directory: `src-tauri`

Expected: compilation fails because `CURRENT_DB_VERSION` does not exist, or assertions fail because inspection opens read-write, changes journal mode, swallows query failures, or accepts newer versions.

- [ ] **Step 4: Expose the current version and replace mutating validation**

In `src-tauri/src/db.rs`, add:

```rust
pub(crate) const CURRENT_DB_VERSION: i64 = 1;
```

Use it in the existing initializer:

```rust
if version == 0 {
    conn.pragma_update(None, "user_version", CURRENT_DB_VERSION)?;
}
```

In `src-tauri/src/lib.rs`, import it with `Database` and replace the current
single `Path` import with the grouped path import:

```rust
use db::{Database, CURRENT_DB_VERSION};
use rusqlite::{Connection, OpenFlags};
use std::io::Read;
use std::path::{Path, PathBuf};
```

Replace `table_exists`, `validate_backup_file`, and both `journal_mode=DELETE` calls with these helpers:

```rust
fn database_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn validate_backup_sidecar_state(path: &Path) -> Result<(), String> {
    let mut header = [0_u8; 20];
    fs::File::open(path)
        .map_err(|e| format!("无法读取备份文件头: {e}"))?
        .read_exact(&mut header)
        .map_err(|e| format!("备份文件头不完整: {e}"))?;
    if &header[..16] != b"SQLite format 3\0" {
        return Err("选择的文件不是有效的 SQLite 数据库".into());
    }

    let wal_mode = header[18] == 2 || header[19] == 2;
    let wal_path = database_sidecar_path(path, "-wal");
    let shm_path = database_sidecar_path(path, "-shm");
    if wal_mode || wal_path.exists() || shm_path.exists() {
        return Err(
            "选择的是活动 WAL 数据库，不是自包含的 Protocol 备份；请先使用应用内 SQLite 备份"
                .into(),
        );
    }
    Ok(())
}

fn open_backup_read_only(path: &Path) -> Result<Connection, String> {
    validate_backup_sidecar_state(path)?;
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_NO_MUTEX
        | OpenFlags::SQLITE_OPEN_NOFOLLOW;
    Connection::open_with_flags(path, flags)
        .map_err(|e| format!("无法只读打开 SQLite 备份: {e}"))
}

fn check_database_integrity(conn: &Connection) -> Result<(), String> {
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| format!("无法检查数据库完整性: {e}"))?;
    if result == "ok" {
        Ok(())
    } else {
        Err(format!("数据库完整性检查失败: {result}"))
    }
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .map_err(|e| format!("无法检查数据表 {table}: {e}"))
}

fn validate_backup_source(conn: &Connection) -> Result<(), String> {
    check_database_integrity(conn)?;

    let mut missing = Vec::new();
    for table in REQUIRED_TABLES {
        if !table_exists(conn, table)? {
            missing.push(*table);
        }
    }
    if !missing.is_empty() {
        return Err(format!("备份文件缺少必要的表: {}", missing.join(", ")));
    }

    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("无法读取数据库版本: {e}"))?;
    if version > CURRENT_DB_VERSION {
        return Err(format!(
            "备份数据库版本 {version} 高于当前支持版本 {CURRENT_DB_VERSION}"
        ));
    }
    Ok(())
}

fn validate_backup_file(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("备份文件不存在".into());
    }
    let conn = open_backup_read_only(path)?;
    validate_backup_source(&conn)
}
```

The user-selected restore source must be an application-created, self-contained
`VACUUM INTO` backup. Active WAL databases are rejected before SQLite opens
them, so inspection cannot create or modify `-wal`/`-shm`. WAL correctness is
still tested separately for live-to-safety Online Backup copies, where Protocol
already owns the source connection.

Update `inspect_backup_file` to call `validate_backup_source(&conn)?` before reading metadata. Every table count and version query must use `?` with a table-specific error; keep `"(表不存在)"` only for genuinely absent optional RSIP tables.

- [ ] **Step 5: Run targeted and full Rust tests**

Run:

```powershell
cargo test --locked restore_tests::inspect_ -- --nocapture
cargo test --locked
cargo fmt --check
```

Expected: all inspection tests pass; all existing Rust tests remain green.

- [ ] **Step 6: Verify the focused diff and commit**

Run:

```powershell
git diff --check
git status --short
```

Confirm only `db.rs`, the inspection section of `lib.rs`, module registration, and `restore_tests.rs` changed.

Commit:

```powershell
git add src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/src/restore_tests.rs
git commit -m "fix: validate database backups read-only"
```

## Task 2: Build a Validated Staging Snapshot

**Files:**

- Modify: `src-tauri/Cargo.toml:17`
- Modify: `src-tauri/src/db.rs:11-168`
- Modify: `src-tauri/src/lib.rs:1-20,2841-2994`
- Modify: `src-tauri/src/restore_tests.rs`

**Interfaces:**

- Consumes from Task 1:
  - `CURRENT_DB_VERSION`
  - `open_backup_read_only`
  - `validate_backup_source`
  - `check_database_integrity`
- Produces:
  - `pub(crate) fn initialize_schema_on(conn: &Connection) -> SqliteResult<()>`
  - `fn validate_current_schema(conn: &Connection) -> Result<(), String>`
  - `fn copy_database_snapshot(source: &Connection, destination: &mut Connection) -> Result<(), String>`
  - `#[cfg(test)] fn copy_database_snapshot_then_abort(source: &Connection, destination: &mut Connection, pages: i32) -> Result<StepResult, String>`
  - `struct StagedDatabase` with `connection()` and explicit `cleanup() -> Result<(), String>`
  - `fn cleanup_stale_staging_files(staging_dir: &Path, now: SystemTime, minimum_age: Duration) -> Result<(), String>`
  - `fn prepare_restore_staging_from_source(source: &Connection, app_dir: &Path) -> Result<StagedDatabase, String>`
  - `fn prepare_restore_staging(backup_path: &Path, app_dir: &Path) -> Result<StagedDatabase, String>`

- [ ] **Step 1: Write failing staging and backup-transaction tests**

Add this test import. It is expected to remain unresolved during RED until
Step 3 enables the existing Cargo feature:

```rust
use rusqlite::backup::StepResult;
```

Append the following tests to `restore_tests.rs`:

```rust
#[test]
fn copy_failure_leaves_destination_content_intact() {
    let test_dir = RestoreTestDir::new("copy-rollback");
    let source_path = create_protocol_backup(&test_dir.path().join("source"));
    let destination_path = create_protocol_database(&test_dir.path().join("destination"));

    let source = open_backup_read_only(&source_path).unwrap();
    let mut destination = Connection::open(&destination_path).unwrap();
    destination
        .execute("INSERT INTO chains (name) VALUES ('live-old')", [])
        .unwrap();

    let locking_connection = Connection::open(&destination_path).unwrap();
    locking_connection
        .execute_batch("BEGIN EXCLUSIVE; UPDATE chains SET name = name;")
        .unwrap();

    let error = copy_database_snapshot(&source, &mut destination).unwrap_err();
    locking_connection.execute_batch("ROLLBACK").unwrap();

    assert!(
        error.contains("占用")
            || error.contains("锁")
            || error.to_lowercase().contains("locked")
    );
    let name: String = destination
        .query_row("SELECT name FROM chains", [], |row| row.get(0))
        .unwrap();
    assert_eq!(name, "live-old");
}

#[test]
fn copy_locked_source_leaves_destination_content_intact() {
    let test_dir = RestoreTestDir::new("copy-locked");
    let source_path = create_protocol_backup(&test_dir.path().join("source"));
    let destination_path =
        create_protocol_database(&test_dir.path().join("destination"));
    let source = Connection::open(&source_path).unwrap();
    source
        .execute_batch(
            "BEGIN IMMEDIATE;
             INSERT INTO chains (name) VALUES ('uncommitted-source');",
        )
        .unwrap();
    let mut destination = Connection::open(&destination_path).unwrap();
    destination
        .execute("INSERT INTO chains (name) VALUES ('live-old')", [])
        .unwrap();

    let error = copy_database_snapshot(&source, &mut destination).unwrap_err();
    source.execute_batch("ROLLBACK").unwrap();

    assert!(
        error.contains("锁")
            || error.to_lowercase().contains("locked")
    );
    let name: String = destination
        .query_row("SELECT name FROM chains", [], |row| row.get(0))
        .unwrap();
    assert_eq!(name, "live-old");
}

#[test]
fn abandoning_backup_after_partial_page_copy_rolls_back_destination() {
    let test_dir = RestoreTestDir::new("copy-partial-rollback");
    let source_dir = test_dir.path().join("source");
    let source_database = Database::new(source_dir).unwrap();
    let source = source_database.conn.lock().unwrap();
    source
        .execute_batch(
            "
            CREATE TABLE large_rows (payload BLOB NOT NULL);
            WITH RECURSIVE n(value) AS (
                SELECT 1
                UNION ALL
                SELECT value + 1 FROM n WHERE value < 100
            )
            INSERT INTO large_rows (payload)
            SELECT zeroblob(16384) FROM n;
            ",
        )
        .unwrap();

    let destination_path =
        create_protocol_database(&test_dir.path().join("destination"));
    let mut destination = Connection::open(&destination_path).unwrap();
    destination
        .execute("INSERT INTO chains (name) VALUES ('live-old')", [])
        .unwrap();

    let step = copy_database_snapshot_then_abort(&source, &mut destination, 1)
        .unwrap();

    assert_eq!(step, StepResult::More);
    let name: String = destination
        .query_row("SELECT name FROM chains", [], |row| row.get(0))
        .unwrap();
    assert_eq!(name, "live-old");
    assert!(!table_exists(&destination, "large_rows").unwrap());
}

#[test]
fn snapshot_copy_includes_committed_live_wal_content() {
    let test_dir = RestoreTestDir::new("snapshot-wal");
    let source_dir = test_dir.path().join("source-app");
    let source_database = Database::new(source_dir.clone()).unwrap();
    {
        let conn = source_database.conn.lock().unwrap();
        conn.execute("INSERT INTO chains (name) VALUES ('wal-committed')", [])
            .unwrap();
    }
    let snapshot_path = test_dir.path().join("snapshot.sqlite");
    let mut snapshot = Connection::open(&snapshot_path).unwrap();
    {
        let source = source_database.conn.lock().unwrap();
        copy_database_snapshot(&source, &mut snapshot).unwrap();
    }

    let name: String = snapshot
        .query_row("SELECT name FROM chains", [], |row| row.get(0))
        .unwrap();
    assert_eq!(name, "wal-committed");
}

#[test]
fn staging_revalidates_the_authoritative_snapshot_version() {
    let test_dir = RestoreTestDir::new("staging-version-race");
    let source_path = create_protocol_backup(test_dir.path());
    let source = open_backup_read_only(&source_path).unwrap();
    validate_backup_source(&source).unwrap();

    let writer = Connection::open(&source_path).unwrap();
    writer
        .pragma_update(None, "user_version", CURRENT_DB_VERSION + 1)
        .unwrap();
    drop(writer);

    let error = match prepare_restore_staging_from_source(
        &source,
        &test_dir.path().join("staging"),
    ) {
        Ok(_) => panic!("staging accepted a snapshot that changed to a newer version"),
        Err(error) => error,
    };

    assert!(error.contains("版本"));
    assert!(error.contains(&(CURRENT_DB_VERSION + 1).to_string()));
}

#[test]
fn staging_reuses_schema_initializer_for_legacy_database() {
    let test_dir = RestoreTestDir::new("staging-legacy");
    let source_path = test_dir.path().join("legacy.sqlite");
    create_legacy_protocol_database(&source_path);

    let staging =
        prepare_restore_staging(&source_path, &test_dir.path().join("staging")).unwrap();

    validate_current_schema(staging.connection()).unwrap();
    let name: String = staging
        .connection()
        .query_row("SELECT name FROM chains WHERE id = 1", [], |row| row.get(0))
        .unwrap();
    assert_eq!(name, "legacy-chain");
    assert!(table_exists(staging.connection(), "rsip_goals").unwrap());
    let (precedent_title, precedent_status): (String, String) = staging
        .connection()
        .query_row(
            "SELECT title, status FROM precedents WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let removed_columns: i64 = staging
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('precedents')
             WHERE name IN (
                 'category', 'failure_reason', 'ruling_note',
                 'severity', 'created_from_context'
             )",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(precedent_title, "legacy-boundary");
    assert_eq!(precedent_status, "active");
    assert_eq!(removed_columns, 0);
}

#[test]
fn staging_rejects_missing_required_columns_before_live_restore() {
    let test_dir = RestoreTestDir::new("staging-missing-column");
    let source_path = test_dir.path().join("invalid.sqlite");
    create_protocol_database_missing_chain_name(&source_path);

    let error = match prepare_restore_staging(
        &source_path,
        &test_dir.path().join("staging"),
    ) {
        Ok(_) => panic!("staging unexpectedly accepted a missing chains.name column"),
        Err(error) => error,
    };

    assert!(error.contains("chains") && error.contains("name"));
}

#[test]
fn staging_files_are_removed_after_drop_and_validation_failure() {
    let test_dir = RestoreTestDir::new("staging-cleanup");
    let source_path = create_protocol_backup(&test_dir.path().join("source"));
    let staging_root = test_dir.path().join("staging-root");
    let staging_dir = staging_root.join(".restore");

    let mut staging = prepare_restore_staging(&source_path, &staging_root).unwrap();
    assert!(staging.path.is_file());
    staging.cleanup().unwrap();
    drop(staging);
    assert_eq!(std::fs::read_dir(&staging_dir).unwrap().count(), 0);

    let invalid_path = test_dir.path().join("missing-column.sqlite");
    create_protocol_database_missing_chain_name(&invalid_path);
    assert!(prepare_restore_staging(&invalid_path, &staging_root).is_err());
    assert_eq!(std::fs::read_dir(&staging_dir).unwrap().count(), 0);
}

#[test]
fn staging_cleanup_reports_locked_or_unremovable_paths() {
    let test_dir = RestoreTestDir::new("staging-cleanup-error");
    let source_path = create_protocol_backup(&test_dir.path().join("source"));
    let staging_root = test_dir.path().join("staging-root");
    let mut staging = prepare_restore_staging(&source_path, &staging_root).unwrap();
    let wal_directory = sidecar_path(&staging.path, "-wal");
    std::fs::create_dir(&wal_directory).unwrap();

    let error = staging.cleanup().unwrap_err();

    assert!(error.contains(&wal_directory.display().to_string()));
    std::fs::remove_dir(&wal_directory).unwrap();
}

#[test]
fn stale_cleanup_removes_only_old_task_owned_staging_files() {
    let test_dir = RestoreTestDir::new("staging-stale");
    let staging_dir = test_dir.path().join(".restore");
    std::fs::create_dir_all(&staging_dir).unwrap();
    let stale = unique_database_path(&staging_dir, "staging").unwrap();
    let unrelated = staging_dir.join("keep-me.sqlite");
    std::fs::write(&unrelated, b"keep").unwrap();

    cleanup_stale_staging_files(
        &staging_dir,
        SystemTime::now(),
        Duration::ZERO,
    )
    .unwrap();

    assert!(!stale.exists());
    assert!(unrelated.exists());
}
```

Add concrete fixtures:

```rust
fn create_legacy_protocol_database(path: &Path) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
        "
        CREATE TABLE chains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            focus_duration_minutes INTEGER NOT NULL DEFAULT 25,
            current_length INTEGER NOT NULL DEFAULT 0,
            best_length INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE focus_sessions (
            id INTEGER PRIMARY KEY, chain_id INTEGER NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            expected_end_at TEXT, ended_at TEXT, duration_minutes INTEGER,
            result TEXT, failure_note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE reservation_sessions (
            id INTEGER PRIMARY KEY, chain_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            due_at TEXT NOT NULL, fulfilled_at TEXT,
            result TEXT, failure_note TEXT
        );
        CREATE TABLE precedents (
            id INTEGER PRIMARY KEY, chain_id INTEGER NOT NULL,
            scope TEXT NOT NULL, title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_from_session_id INTEGER,
            created_from_session_type TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            category TEXT,
            failure_reason TEXT,
            ruling_note TEXT,
            severity TEXT,
            created_from_context TEXT
        );
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO chains (id, name) VALUES (1, 'legacy-chain');
        INSERT INTO precedents (
            id, chain_id, scope, title, description,
            category, failure_reason, ruling_note,
            severity, created_from_context
        ) VALUES (
            1, 1, 'main_chain', 'legacy-boundary', 'legacy detail',
            'legacy', 'reason', 'ruling', 'high', 'context'
        );
        INSERT INTO app_settings (key, value) VALUES ('default_focus_duration', '25');
        PRAGMA user_version = 0;
        ",
    )
    .unwrap();
}

fn create_protocol_database_missing_chain_name(path: &Path) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
        "
        CREATE TABLE chains (id INTEGER PRIMARY KEY);
        CREATE TABLE focus_sessions (id INTEGER PRIMARY KEY);
        CREATE TABLE reservation_sessions (id INTEGER PRIMARY KEY);
        CREATE TABLE precedents (id INTEGER PRIMARY KEY);
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 1;
        VACUUM;
        ",
    )
    .unwrap();
}
```

- [ ] **Step 2: Run staging tests and confirm RED**

Run:

```powershell
cargo test --locked restore_tests::copy_ -- --nocapture
cargo test --locked restore_tests::abandoning_backup_ -- --nocapture
cargo test --locked restore_tests::snapshot_copy_ -- --nocapture
cargo test --locked restore_tests::staging_ -- --nocapture
```

Expected: compilation fails because Online Backup, `StagedDatabase`, `prepare_restore_staging`, and the reusable initializer do not exist.

- [ ] **Step 3: Enable the existing rusqlite feature**

Change `src-tauri/Cargo.toml` to:

```toml
rusqlite = { version = "0.31", features = ["bundled", "backup"] }
```

Run:

```powershell
cargo check --locked
git diff -- src-tauri/Cargo.lock
```

Expected: check passes after later code is complete; `Cargo.lock` has no dependency-package change because `backup = []`.

- [ ] **Step 4: Extract the schema initializer without changing schema behavior**

Refactor `src-tauri/src/db.rs` so `Database::new` contains:

```rust
let conn = Connection::open(&db_path)?;
conn.execute_batch("PRAGMA journal_mode=WAL;")?;
conn.execute_batch("PRAGMA foreign_keys=ON;")?;
initialize_schema_on(&conn)?;

Ok(Database {
    conn: Mutex::new(conn),
    db_path,
})
```

Cut the complete `conn.execute_batch(...)` statement currently inside
`Database::initialize_schema` into the start of this free function without
editing its SQL literal:

```rust
pub(crate) fn initialize_schema_on(conn: &Connection) -> SqliteResult<()> {
```

Immediately after that byte-for-byte unchanged statement, append:

```rust
    migrate_precedents_to_core_schema(conn)?;
    migrate_protocol_config_schema(conn)?;
    migrate_rsip_goal_translation_schema(conn)?;

    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);
    if version == 0 {
        conn.pragma_update(None, "user_version", CURRENT_DB_VERSION)?;
    }
    Ok(())
}
```

Delete the old method wrapper after `Database::new` calls the free function.
The SQL literal and the three migration calls must not change behavior during
this refactor.

- [ ] **Step 5: Implement current-schema validation and one-shot snapshot copy**

Import:

```rust
use db::{initialize_schema_on, Database, CURRENT_DB_VERSION};
use rusqlite::backup::{Backup, StepResult};
```

Add exact current-schema probes:

```rust
const CURRENT_SCHEMA_PROBES: &[(&str, &str)] = &[
    ("chains", "SELECT id, name, description, trigger_action, completion_condition, focus_duration_minutes, auxiliary_trigger_action, auxiliary_delay_minutes, auxiliary_completion_condition, auxiliary_current_length, auxiliary_best_length, current_length, best_length, status, created_at, updated_at FROM chains LIMIT 0"),
    ("focus_sessions", "SELECT id, chain_id, started_at, expected_end_at, ended_at, duration_minutes, result, failure_note, trigger_action, completion_condition, debug_category, debug_note, created_at FROM focus_sessions LIMIT 0"),
    ("reservation_sessions", "SELECT id, chain_id, created_at, due_at, confirmation_due_at, fulfilled_at, result, failure_note, trigger_action, completion_condition, debug_category, debug_note FROM reservation_sessions LIMIT 0"),
    ("precedents", "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents LIMIT 0"),
    ("app_settings", "SELECT key, value FROM app_settings LIMIT 0"),
    ("rsip_formulas", "SELECT id, parent_id, title, description, status, position, created_at, updated_at, activated_at, deactivated_at, goal_id, failure_path_id, intervention_node_id, dependency_note FROM rsip_formulas LIMIT 0"),
    ("formula_events", "SELECT id, formula_id, event_type, note, created_at FROM formula_events LIMIT 0"),
    ("rsip_goals", "SELECT id, title, description, status, created_at, updated_at, archived_at FROM rsip_goals LIMIT 0"),
    ("rsip_failure_paths", "SELECT id, goal_id, title, nodes_json, created_at, updated_at FROM rsip_failure_paths LIMIT 0"),
];
```

Implement:

```rust
fn validate_current_schema(conn: &Connection) -> Result<(), String> {
    check_database_integrity(conn)?;

    let mut foreign_key_statement = conn
        .prepare("PRAGMA foreign_key_check")
        .map_err(|e| format!("无法执行外键检查: {e}"))?;
    let mut foreign_key_rows = foreign_key_statement
        .query([])
        .map_err(|e| format!("无法读取外键检查结果: {e}"))?;
    if foreign_key_rows
        .next()
        .map_err(|e| format!("无法读取外键检查结果: {e}"))?
        .is_some()
    {
        return Err("数据库存在外键约束错误".into());
    }

    for (table, sql) in CURRENT_SCHEMA_PROBES {
        conn.prepare(sql)
            .map_err(|e| format!("数据表 {table} 缺少当前版本所需字段: {e}"))?;
    }
    Ok(())
}

fn copy_database_snapshot(
    source: &Connection,
    destination: &mut Connection,
) -> Result<(), String> {
    let step_result = {
        let backup = Backup::new(source, destination)
            .map_err(|e| format!("无法初始化 SQLite 快照复制: {e}"))?;
        backup
            .step(-1)
            .map_err(|e| format!("SQLite 快照复制失败: {e}"))?
    };

    match step_result {
        StepResult::Done => Ok(()),
        StepResult::Busy => Err("数据库正在被其他连接占用".into()),
        StepResult::Locked => Err("数据库被写事务锁定".into()),
        StepResult::More => Err("SQLite 快照复制未在单次操作中完成".into()),
        _ => Err("SQLite 返回未知快照状态".into()),
    }
}

#[cfg(test)]
fn copy_database_snapshot_then_abort(
    source: &Connection,
    destination: &mut Connection,
    pages: i32,
) -> Result<StepResult, String> {
    let backup = Backup::new(source, destination)
        .map_err(|e| format!("无法初始化测试快照复制: {e}"))?;
    let result = backup
        .step(pages)
        .map_err(|e| format!("测试快照复制失败: {e}"))?;
    drop(backup);
    Ok(result)
}
```

- [ ] **Step 6: Implement collision-safe staging with cleanup**

Add the required standard-library imports:

```rust
use std::fs::OpenOptions;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
```

Add a static file counter and helpers:

```rust
static RESTORE_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_database_path(dir: &Path, prefix: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("无法创建数据库临时目录: {e}"))?;
    for _ in 0..100 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("系统时间异常: {e}"))?
            .as_nanos();
        let counter = RESTORE_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = dir.join(format!(
            "{prefix}-{nanos}-{}-{counter}.sqlite",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                drop(file);
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建数据库临时文件: {error}")),
        }
    }
    Err("无法生成唯一数据库临时文件名".into())
}

fn remove_database_files(path: &Path) -> Result<(), String> {
    let sidecar = |suffix: &str| {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        PathBuf::from(name)
    };
    let candidates = [
        path.to_path_buf(),
        sidecar("-wal"),
        sidecar("-shm"),
        sidecar("-journal"),
    ];
    let mut errors = Vec::new();
    for candidate in &candidates {
        match fs::remove_file(candidate) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => errors.push(format!("{}: {error}", candidate.display())),
        }
    }
    for candidate in &candidates {
        if candidate.exists() {
            errors.push(format!("清理后文件仍存在: {}", candidate.display()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn cleanup_stale_staging_files(
    staging_dir: &Path,
    now: SystemTime,
    minimum_age: Duration,
) -> Result<(), String> {
    if !staging_dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(staging_dir)
        .map_err(|e| format!("无法扫描 staging 目录: {e}"))?
    {
        let entry = entry.map_err(|e| format!("无法读取 staging 条目: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("staging-") || !name.ends_with(".sqlite") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .map_err(|e| format!("无法读取 staging 修改时间: {e}"))?;
        if now.duration_since(modified).unwrap_or_default() >= minimum_age {
            remove_database_files(&entry.path())?;
        }
    }
    Ok(())
}

struct StagedDatabase {
    path: PathBuf,
    connection: Option<Connection>,
}

impl StagedDatabase {
    fn connection(&self) -> &Connection {
        self.connection.as_ref().expect("staging connection exists")
    }

    fn cleanup(&mut self) -> Result<(), String> {
        drop(self.connection.take());
        remove_database_files(&self.path)
    }
}

impl Drop for StagedDatabase {
    fn drop(&mut self) {
        drop(self.connection.take());
        let _ = remove_database_files(&self.path);
    }
}
```

Implement staging:

```rust
fn prepare_restore_staging_from_source(
    source: &Connection,
    app_dir: &Path,
) -> Result<StagedDatabase, String> {
    let staging_dir = app_dir.join(".restore");
    let staging_path = unique_database_path(&staging_dir, "staging")?;
    let result = (|| {
        let mut staging = Connection::open(&staging_path)
            .map_err(|e| format!("无法打开恢复 staging 数据库: {e}"))?;
        copy_database_snapshot(source, &mut staging)?;
        validate_backup_source(&staging)?;
        staging
            .execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("无法启用 staging 外键: {e}"))?;
        initialize_schema_on(&staging)
            .map_err(|e| format!("无法升级恢复 staging 数据库: {e}"))?;
        validate_current_schema(&staging)?;
        let version: i64 = staging
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| format!("无法读取 staging 数据库版本: {e}"))?;
        if version != CURRENT_DB_VERSION {
            return Err(format!(
                "staging 数据库版本 {version} 未迁移到 {CURRENT_DB_VERSION}"
            ));
        }
        Ok(staging)
    })();

    match result {
        Ok(connection) => Ok(StagedDatabase {
            path: staging_path,
            connection: Some(connection),
        }),
        Err(error) => match remove_database_files(&staging_path) {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(format!(
                "{error}; staging 清理也失败: {cleanup_error}"
            )),
        },
    }
}

fn prepare_restore_staging(
    backup_path: &Path,
    app_dir: &Path,
) -> Result<StagedDatabase, String> {
    let staging_dir = app_dir.join(".restore");
    cleanup_stale_staging_files(
        &staging_dir,
        SystemTime::now(),
        Duration::from_secs(7 * 24 * 60 * 60),
    )?;
    let source = open_backup_read_only(backup_path)?;
    validate_backup_source(&source)?;
    prepare_restore_staging_from_source(&source, app_dir)
}
```

Only task-owned `staging-*.sqlite` files older than seven days are eligible for
stale cleanup. Recent files are left alone so a concurrent Protocol process is
not disrupted. Every ordinary success/error path calls `StagedDatabase::cleanup`
explicitly later; `Drop` is only a last-resort fallback during unwinding.

- [ ] **Step 7: Run targeted and full verification**

Run:

```powershell
cargo test --locked restore_tests::copy_ -- --nocapture
cargo test --locked restore_tests::abandoning_backup_ -- --nocapture
cargo test --locked restore_tests::snapshot_copy_ -- --nocapture
cargo test --locked restore_tests::staging_ -- --nocapture
cargo test --locked
cargo check --locked
cargo fmt --check
git diff --check
```

Expected: all tests pass; `Cargo.lock` contains no package additions; live databases used by tests remain unchanged on staging failures.

- [ ] **Step 8: Commit the staging boundary**

Run:

```powershell
git status --short
git add src-tauri/Cargo.toml src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/src/restore_tests.rs
git commit -m "feat: prepare validated restore snapshots"
```

## Task 3: Restore into the Live Connection with Safety Rollback

**Files:**

- Modify: `src-tauri/src/lib.rs:2995-3036`
- Modify: `src-tauri/src/restore_tests.rs`

**Interfaces:**

- Consumes from Task 2:
  - `StagedDatabase::connection()`
  - `prepare_restore_staging`
  - `unique_database_path`
  - `copy_database_snapshot`
  - `validate_current_schema`
  - `open_backup_read_only`
- Produces:
  - `struct RestoreSuccess { safety_path: PathBuf, staging_cleanup_warning: Option<String> }`
  - `fn restore_database_inner(database: &Database, backup_path: &Path) -> Result<RestoreSuccess, String>`
  - `fn restore_database_inner_with_validator<F>(database: &Database, backup_path: &Path, validator: F) -> Result<RestoreSuccess, String> where F: FnOnce(&Connection) -> Result<(), String>`
  - `fn restore_database_inner_with_hooks<F, R>(database: &Database, backup_path: &Path, validator: F, rollback_copier: R) -> Result<RestoreSuccess, String>`
  - corrected Tauri command `restore_database`

- [ ] **Step 1: Write failing immediate-activation and safety-snapshot tests**

Append:

```rust
fn insert_chain(database: &Database, name: &str) {
    database
        .conn
        .lock()
        .unwrap()
        .execute("INSERT INTO chains (name) VALUES (?1)", [name])
        .unwrap();
}

fn chain_names(database: &Database) -> Vec<String> {
    let conn = database.conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT name FROM chains ORDER BY id").unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<String>>>()
        .unwrap()
}

fn write_restore_backup(database: &Database, path: &Path) {
    let escaped = path.to_string_lossy().replace('\'', "''");
    database
        .conn
        .lock()
        .unwrap()
        .execute_batch(&format!("VACUUM INTO '{escaped}';"))
        .unwrap();
}

#[test]
fn restore_applies_backup_to_existing_connection_and_keeps_safety_snapshot() {
    let test_dir = RestoreTestDir::new("restore-live");
    let live = Database::new(test_dir.path().join("live")).unwrap();
    insert_chain(&live, "live-old");

    let backup_dir = test_dir.path().join("backup");
    let backup = Database::new(backup_dir.clone()).unwrap();
    insert_chain(&backup, "backup-new");
    let backup_path = backup_dir.join("restore.sqlite");
    write_restore_backup(&backup, &backup_path);
    drop(backup);

    let result = restore_database_inner(&live, &backup_path).unwrap();

    assert_eq!(chain_names(&live), vec!["backup-new"]);
    let conn = live.conn.lock().unwrap();
    let journal_mode: String = conn
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .unwrap();
    let foreign_keys: i64 = conn
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap();
    drop(conn);
    assert_eq!(journal_mode.to_lowercase(), "wal");
    assert_eq!(foreign_keys, 1);
    assert!(result.safety_path.is_file());
    let staging_dir = live.db_path.parent().unwrap().join(".restore");
    assert_eq!(std::fs::read_dir(staging_dir).unwrap().count(), 0);
    let safety = open_backup_read_only(&result.safety_path).unwrap();
    let safety_name: String = safety
        .query_row("SELECT name FROM chains", [], |row| row.get(0))
        .unwrap();
    assert_eq!(safety_name, "live-old");
}

#[test]
fn restore_rejects_live_database_as_its_own_source() {
    let test_dir = RestoreTestDir::new("restore-self");
    let live_dir = test_dir.path().join("live");
    let live = Database::new(live_dir.clone()).unwrap();
    insert_chain(&live, "live-old");

    let error =
        restore_database_inner(&live, &live_dir.join("protocol.db")).unwrap_err();

    assert!(error.contains("当前数据库"));
    assert_eq!(chain_names(&live), vec!["live-old"]);
}

#[test]
fn restore_rejects_page_size_mismatch_before_touching_live() {
    let test_dir = RestoreTestDir::new("restore-page-size");
    let live = Database::new(test_dir.path().join("live")).unwrap();
    insert_chain(&live, "live-old");

    let backup_dir = test_dir.path().join("backup");
    let backup = Database::new(backup_dir.clone()).unwrap();
    insert_chain(&backup, "backup-new");
    let backup_path = backup_dir.join("restore.sqlite");
    write_restore_backup(&backup, &backup_path);
    drop(backup);
    let backup_conn = Connection::open(&backup_path).unwrap();
    backup_conn
        .execute_batch(
            "PRAGMA journal_mode=DELETE;
             PRAGMA page_size=8192;
             VACUUM;",
        )
        .unwrap();
    let backup_page_size: i64 = backup_conn
        .pragma_query_value(None, "page_size", |row| row.get(0))
        .unwrap();
    drop(backup_conn);
    assert_eq!(backup_page_size, 8192);

    let error = restore_database_inner(&live, &backup_path).unwrap_err();

    assert!(error.contains("page size"));
    assert_eq!(chain_names(&live), vec!["live-old"]);
}

#[test]
fn rapid_restores_create_distinct_safety_snapshots() {
    let test_dir = RestoreTestDir::new("restore-rapid");
    let live = Database::new(test_dir.path().join("live")).unwrap();
    insert_chain(&live, "live-old");

    let backup_dir = test_dir.path().join("backup");
    let backup = Database::new(backup_dir.clone()).unwrap();
    insert_chain(&backup, "backup-new");
    let backup_path = backup_dir.join("restore.sqlite");
    write_restore_backup(&backup, &backup_path);
    drop(backup);

    let first = restore_database_inner(&live, &backup_path).unwrap();
    insert_chain(&live, "between-restores");
    let second = restore_database_inner(&live, &backup_path).unwrap();

    assert_ne!(first.safety_path, second.safety_path);
    assert!(first.safety_path.is_file());
    assert!(second.safety_path.is_file());
}

#[test]
fn restore_round_trip_preserves_all_application_tables() {
    let test_dir = RestoreTestDir::new("restore-all-tables");
    let live = Database::new(test_dir.path().join("live")).unwrap();

    let backup_dir = test_dir.path().join("backup");
    let backup = Database::new(backup_dir.clone()).unwrap();
    {
        let conn = backup.conn.lock().unwrap();
        conn.execute_batch(
            "
            INSERT INTO chains (id, name, description)
            VALUES (1, '晨间链', '保留 Unicode');
            INSERT INTO focus_sessions (id, chain_id, expected_end_at)
            VALUES (1, 1, NULL);
            INSERT INTO reservation_sessions (id, chain_id, due_at)
            VALUES (1, 1, '2026-07-27 08:00:00');
            INSERT INTO precedents (id, chain_id, scope, title)
            VALUES (1, 1, 'main_chain', '离线边界');
            UPDATE app_settings
            SET value = '37'
            WHERE key = 'default_focus_duration';
            INSERT INTO rsip_goals (id, title)
            VALUES (1, '更早睡觉');
            INSERT INTO rsip_failure_paths (id, goal_id, title, nodes_json)
            VALUES (1, 1, '睡前漂移', '[{\"id\":\"node-1\",\"text\":\"拿起手机\"}]');
            INSERT INTO rsip_formulas (
                id, title, goal_id, failure_path_id, intervention_node_id
            ) VALUES (1, '手机离床', 1, 1, 'node-1');
            INSERT INTO formula_events (id, formula_id, event_type)
            VALUES (1, 1, 'created');
            ",
        )
        .unwrap();
    }
    let backup_path = backup_dir.join("restore.sqlite");
    write_restore_backup(&backup, &backup_path);
    drop(backup);

    restore_database_inner(&live, &backup_path).unwrap();

    let conn = live.conn.lock().unwrap();
    for table in [
        "chains",
        "focus_sessions",
        "reservation_sessions",
        "precedents",
        "app_settings",
        "rsip_formulas",
        "formula_events",
        "rsip_goals",
        "rsip_failure_paths",
    ] {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
            .unwrap();
        assert!(count > 0, "{table} should survive restore");
    }
    let description: String = conn
        .query_row("SELECT description FROM chains WHERE id = 1", [], |row| row.get(0))
        .unwrap();
    let expected_end_at: Option<String> = conn
        .query_row(
            "SELECT expected_end_at FROM focus_sessions WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let focus_duration_setting: String = conn
        .query_row(
            "SELECT value FROM app_settings
             WHERE key = 'default_focus_duration'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let formula_relationship: (String, String, String, String) = conn
        .query_row(
            "
            SELECT formula.title, goal.title, path.title, path.nodes_json
            FROM rsip_formulas AS formula
            JOIN rsip_goals AS goal ON goal.id = formula.goal_id
            JOIN rsip_failure_paths AS path
              ON path.id = formula.failure_path_id
            WHERE formula.id = 1
            ",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    let formula_event_id: i64 = conn
        .query_row(
            "SELECT formula_id FROM formula_events WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(description, "保留 Unicode");
    assert_eq!(expected_end_at, None);
    assert_eq!(focus_duration_setting, "37");
    assert_eq!(
        formula_relationship,
        (
            "手机离床".into(),
            "更早睡觉".into(),
            "睡前漂移".into(),
            "[{\"id\":\"node-1\",\"text\":\"拿起手机\"}]".into(),
        )
    );
    assert_eq!(formula_event_id, 1);
}
```

- [ ] **Step 2: Write failing rollback and mutex-lifetime tests**

Append:

```rust
#[test]
fn post_restore_validation_failure_rolls_back_safety_snapshot() {
    let test_dir = RestoreTestDir::new("restore-post-validation");
    let live = Database::new(test_dir.path().join("live")).unwrap();
    insert_chain(&live, "live-old");

    let backup_dir = test_dir.path().join("backup");
    let backup = Database::new(backup_dir.clone()).unwrap();
    insert_chain(&backup, "backup-new");
    let backup_path = backup_dir.join("restore.sqlite");
    write_restore_backup(&backup, &backup_path);
    drop(backup);

    let error = restore_database_inner_with_validator(
        &live,
        &backup_path,
        |_| Err("injected post-copy failure".into()),
    )
    .unwrap_err();

    assert!(error.contains("injected post-copy failure"));
    assert!(error.contains("已自动恢复"));
    assert_eq!(chain_names(&live), vec!["live-old"]);
}

#[test]
fn restore_rollback_failure_reports_both_errors_and_preserves_safety_snapshot() {
    let test_dir = RestoreTestDir::new("restore-rollback-failure");
    let live = Database::new(test_dir.path().join("live")).unwrap();
    insert_chain(&live, "live-old");

    let backup_dir = test_dir.path().join("backup");
    let backup = Database::new(backup_dir.clone()).unwrap();
    insert_chain(&backup, "backup-new");
    let backup_path = backup_dir.join("restore.sqlite");
    write_restore_backup(&backup, &backup_path);
    drop(backup);

    let error = restore_database_inner_with_hooks(
        &live,
        &backup_path,
        |_| Err("injected post-copy failure".into()),
        |_, _| Err("injected rollback failure".into()),
    )
    .unwrap_err();

    assert!(error.contains("injected post-copy failure"));
    assert!(error.contains("injected rollback failure"));
    let safety_path = error
        .lines()
        .find_map(|line| line.strip_prefix("安全快照: "))
        .map(PathBuf::from)
        .expect("error should preserve the safety snapshot path");
    assert!(safety_path.is_file());
}

#[test]
fn restore_holds_database_mutex_through_post_copy_validation() {
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    let test_dir = RestoreTestDir::new("restore-mutex");
    let live = Arc::new(Database::new(test_dir.path().join("live")).unwrap());
    insert_chain(&live, "live-old");

    let backup_dir = test_dir.path().join("backup");
    let backup = Database::new(backup_dir.clone()).unwrap();
    insert_chain(&backup, "backup-new");
    let backup_path = backup_dir.join("restore.sqlite");
    write_restore_backup(&backup, &backup_path);
    drop(backup);

    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let restore_live = Arc::clone(&live);
    let restore_thread = std::thread::spawn(move || {
        restore_database_inner_with_validator(&restore_live, &backup_path, |conn| {
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            validate_current_schema(conn)
        })
    });

    entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let (acquired_tx, acquired_rx) = mpsc::channel();
    let query_live = Arc::clone(&live);
    let query_thread = std::thread::spawn(move || {
        let _guard = query_live.conn.lock().unwrap();
        acquired_tx.send(()).unwrap();
    });

    assert!(acquired_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release_tx.send(()).unwrap();
    restore_thread.join().unwrap().unwrap();
    acquired_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    query_thread.join().unwrap();
}
```

- [ ] **Step 3: Run the restore tests and confirm RED**

Run:

```powershell
cargo test --locked restore_tests::restore_ -- --nocapture
cargo test --locked restore_tests::post_restore_ -- --nocapture
```

Expected: compilation fails because `RestoreSuccess`, inner restore functions, and live rollback do not exist; the old Tauri command still uses `fs::copy`.

- [ ] **Step 4: Implement canonical source rejection and safety snapshot creation**

Add:

```rust
#[derive(Debug)]
struct RestoreSuccess {
    safety_path: PathBuf,
    staging_cleanup_warning: Option<String>,
}

fn canonical_existing_path(path: &Path, label: &str) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("无法解析{label}路径 {}: {e}", path.display()))
}

fn create_safety_snapshot(
    live: &Connection,
    database_path: &Path,
) -> Result<PathBuf, String> {
    let app_dir = database_path
        .parent()
        .ok_or_else(|| "无法定位数据库目录".to_string())?;
    let safety_dir = app_dir.join(".backup");
    let safety_path = unique_database_path(&safety_dir, "pre-restore")?;

    let result = (|| {
        let mut safety = Connection::open(&safety_path)
            .map_err(|e| format!("无法创建恢复前安全快照: {e}"))?;
        copy_database_snapshot(live, &mut safety)?;
        drop(safety);
        let safety = open_backup_read_only(&safety_path)?;
        validate_current_schema(&safety)?;
        Ok(())
    })();

    match result {
        Ok(()) => Ok(safety_path),
        Err(error) => match remove_database_files(&safety_path) {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(format!(
                "{error}; 无效安全快照清理也失败: {cleanup_error}"
            )),
        },
    }
}
```

At the start of restore, compare:

```rust
let backup_canonical = canonical_existing_path(backup_path, "备份")?;
let live_canonical = canonical_existing_path(&database.db_path, "当前数据库")?;
if backup_canonical == live_canonical {
    return Err("不能使用当前数据库自身作为恢复源".into());
}
```

- [ ] **Step 5: Implement the restore transaction and automatic safety rollback**

Add:

```rust
fn database_page_size(conn: &Connection) -> Result<i64, String> {
    conn.pragma_query_value(None, "page_size", |row| row.get(0))
        .map_err(|e| format!("无法读取数据库 page size: {e}"))
}

fn restore_database_inner(
    database: &Database,
    backup_path: &Path,
) -> Result<RestoreSuccess, String> {
    restore_database_inner_with_validator(database, backup_path, validate_current_schema)
}

fn rollback_live_after_failure<R>(
    live: &mut Connection,
    safety_path: &Path,
    restore_error: String,
    rollback_copier: R,
) -> Result<RestoreSuccess, String>
where
    R: FnOnce(&Connection, &mut Connection) -> Result<(), String>,
{
    let rollback_result = (|| {
        let safety = open_backup_read_only(safety_path)?;
        rollback_copier(&safety, live)?;
        validate_current_schema(live)
    })();

    match rollback_result {
        Ok(()) => Err(format!(
            "恢复后校验失败，已自动恢复原数据库: {restore_error}\n安全快照: {}",
            safety_path.display()
        )),
        Err(rollback_error) => Err(format!(
            "恢复后校验失败且自动回滚失败: {restore_error}; {rollback_error}\n安全快照: {}",
            safety_path.display()
        )),
    }
}

fn restore_database_inner_with_validator<F>(
    database: &Database,
    backup_path: &Path,
    post_restore_validator: F,
) -> Result<RestoreSuccess, String>
where
    F: FnOnce(&Connection) -> Result<(), String>,
{
    restore_database_inner_with_hooks(
        database,
        backup_path,
        post_restore_validator,
        copy_database_snapshot,
    )
}

fn restore_database_inner_with_hooks<F, R>(
    database: &Database,
    backup_path: &Path,
    post_restore_validator: F,
    rollback_copier: R,
) -> Result<RestoreSuccess, String>
where
    F: FnOnce(&Connection) -> Result<(), String>,
    R: FnOnce(&Connection, &mut Connection) -> Result<(), String>,
{
    let backup_canonical = canonical_existing_path(backup_path, "备份")?;
    let live_canonical = canonical_existing_path(&database.db_path, "当前数据库")?;
    if backup_canonical == live_canonical {
        return Err("不能使用当前数据库自身作为恢复源".into());
    }

    let app_dir = database
        .db_path
        .parent()
        .ok_or_else(|| "无法定位数据库目录".to_string())?;
    let mut staging = prepare_restore_staging(backup_path, app_dir)?;
    let restore_result = (|| {
        let mut live = database.conn.lock().map_err(|e| e.to_string())?;

        let staging_page_size = database_page_size(staging.connection())?;
        let live_page_size = database_page_size(&live)?;
        if staging_page_size != live_page_size {
            return Err(format!(
                "备份 page size {staging_page_size} 与当前数据库 {live_page_size} 不兼容"
            ));
        }

        let safety_path = create_safety_snapshot(&live, &database.db_path)?;
        if let Err(copy_error) = copy_database_snapshot(staging.connection(), &mut live) {
            return Err(format!(
                "恢复写入未完成，当前数据库保持原状: {copy_error}\n安全快照: {}",
                safety_path.display()
            ));
        }

        let post_restore_result = post_restore_validator(&live).and_then(|_| {
            let foreign_keys: i64 = live
                .pragma_query_value(None, "foreign_keys", |row| row.get(0))
                .map_err(|e| format!("无法验证 live 外键设置: {e}"))?;
            if foreign_keys == 1 {
                Ok(())
            } else {
                Err(format!("恢复后外键设置异常: foreign_keys={foreign_keys}"))
            }
        });

        if let Err(restore_error) = post_restore_result {
            return rollback_live_after_failure(
                &mut live,
                &safety_path,
                restore_error,
                rollback_copier,
            );
        }

        Ok(RestoreSuccess {
            safety_path,
            staging_cleanup_warning: None,
        })
    })();

    let cleanup_result = staging.cleanup();
    match (restore_result, cleanup_result) {
        (Ok(success), Ok(())) => Ok(success),
        (Ok(mut success), Err(cleanup_error)) => {
            success.staging_cleanup_warning = Some(cleanup_error);
            Ok(success)
        }
        (Err(error), Ok(())) => Err(error),
        (Err(error), Err(cleanup_error)) => Err(format!(
            "{error}\nstaging 清理也失败: {cleanup_error}"
        )),
    }
}
```

After `copy_database_snapshot(staging.connection(), &mut live)` returns `Done`,
every validation or pragma failure is captured in `post_restore_result` and
routed through `rollback_live_after_failure`; no later `?` may bypass rollback.

- [ ] **Step 6: Replace the unsafe Tauri command**

Replace the existing `restore_database` body and delete its `fs::copy` logic.
Also delete the private `validate_backup_file` wrapper introduced in Task 1;
after staging owns source validation, it has no remaining caller.

```rust
#[tauri::command]
fn restore_database(
    state: tauri::State<'_, Database>,
    backup_path: String,
) -> Result<String, String> {
    let result = restore_database_inner(&state, Path::new(&backup_path))?;
    let mut message = format!(
        "恢复成功，数据已立即生效。\n恢复前安全快照: {}",
        result.safety_path.display()
    );
    if let Some(cleanup_warning) = result.staging_cleanup_warning {
        message.push_str(&format!(
            "\n恢复已成功，但 staging 清理失败: {cleanup_warning}"
        ));
    }
    Ok(message)
}
```

Search:

```powershell
rg -n "fs::copy\\(backup|请重启 Protocol|guard dropped immediately" src-tauri/src/lib.rs
```

Expected: no match in the restore implementation.

- [ ] **Step 7: Run focused, full, and static verification**

Run:

```powershell
cargo test --locked restore_tests::restore_ -- --nocapture
cargo test --locked restore_tests::post_restore_ -- --nocapture
cargo test --locked
cargo check --locked
cargo fmt --check
git diff --check
```

Expected: immediate activation, safety content, self-source rejection, rapid uniqueness, injected rollback, and mutex lifetime all pass. Existing Rust tests remain green.

- [ ] **Step 8: Commit the live restore**

Run:

```powershell
git status --short
git add src-tauri/src/lib.rs src-tauri/src/restore_tests.rs
git commit -m "fix: restore backups through live SQLite connection"
```

## Task 4: Integrate the Immediate Restore UX and Documentation

**Files:**

- Modify: `src/pages/DataManagement.tsx:91-133,316-375`
- Modify: `README.md:98-103,138-165,278-286`
- Modify: `docs/PRODUCT_SPEC.md:247-253`
- Modify: `docs/QA_CHECKLIST.md:185-201`

**Interfaces:**

- Consumes: unchanged `restoreDatabase(backupPath: string): Promise<string>`.
- Produces: accurate confirmation copy, immediate statistics refresh, and documented Windows acceptance steps.

- [ ] **Step 1: Record the current static failure**

Run:

```powershell
rg -n "恢复后请重启|重启 Protocol|替换当前数据库" src/pages/DataManagement.tsx README.md docs/PRODUCT_SPEC.md
rg -n "await restoreDatabase|refreshInfo" src/pages/DataManagement.tsx
```

Expected: user copy still claims restart is required, and `handleRestoreConfirm` does not refresh DB info after restore.

- [ ] **Step 2: Update the frontend success flow**

Make `handleRestoreConfirm` use:

```tsx
const handleRestoreConfirm = async () => {
  if (!backupInfo) return;
  clearMessages();
  setBusy(true);
  try {
    const result = await restoreDatabase(backupInfo.path);
    setBackupInfo(null);
    setSuccess(result);
    try {
      const info = await getDatabaseInfo();
      setDbInfo(info);
    } catch (refreshErr) {
      setError(`恢复已成功，但统计刷新失败: ${String(refreshErr)}`);
    }
  } catch (err) {
    setError(String(err));
  } finally {
    setBusy(false);
  }
};
```

Use these user-visible semantics in the restore section:

```text
恢复会替换当前所有本地数据，包括链进度、设置，以及备份中仍在进行或已经逾期的会话。
恢复前会自动创建并验证当前数据库的安全快照；恢复成功后立即生效，无需重启 Protocol。
请选择由 Protocol“备份当前数据”生成的自包含 SQLite 文件；正在使用的 protocol.db 或 WAL sidecar 组合不会被当作备份恢复。
```

The destructive confirmation must say:

```text
当前数据将被完整替换。确认后应用会立即切换到备份数据。
```

Do not add a reload or restart call.

- [ ] **Step 3: Update repository documentation**

Add these exact behavioral rules:

`README.md`:

```text
- 应用内恢复会先只读检查备份、创建恢复前安全快照，再通过 SQLite 在线恢复切换数据；成功后立即生效。
- 恢复入口只接受 Protocol 生成的自包含 SQLite 备份，不接受仍在使用的 protocol.db/WAL 文件组合。
- JSON 导出不能直接恢复应用；需要可恢复副本时请使用 SQLite 备份。
- 手工复制 protocol.db 前必须从托盘菜单真正退出 Protocol。仅关闭主窗口会隐藏到托盘，不能安全复制正在使用的 WAL 数据库。
```

`docs/PRODUCT_SPEC.md` data-management restore behavior:

```text
恢复流程必须经过只读检查、显式确认、恢复前安全快照和恢复后校验。成功后当前连接立即读取恢复数据；失败不得留下部分恢复状态。
```

`docs/QA_CHECKLIST.md`:

```text
- [ ] Windows：应用保持运行时，从数据集 B 恢复备份 A，统计和页面立即显示 A
- [ ] 恢复前安全快照可打开且包含数据集 B
- [ ] 损坏、缺表、缺列、更高版本和当前 live 数据库自身均在 live 改动前被拒绝
- [ ] 连续快速恢复两次生成不同安全快照
- [ ] 外部连接持锁时恢复清晰失败或等待成功，live 不出现部分覆盖
- [ ] 备份内进行中或逾期 CTDP 会话恢复后收敛到正确状态
```

- [ ] **Step 4: Run frontend and full repository verification**

Run in repository root:

```powershell
npm.cmd run test:unit
npm.cmd run check
npm.cmd run build
```

Run in `src-tauri`:

```powershell
cargo test --locked
cargo check --locked
cargo fmt --check
```

Run in repository root:

```powershell
git diff --check
git status --short
```

Expected:

- 11 frontend unit tests pass.
- TypeScript typecheck and ESLint pass.
- Vite production build passes.
- All existing plus new Rust tests pass.
- Cargo check passes.
- No whitespace errors or unrelated file changes.

- [ ] **Step 5: Perform the available manual acceptance and record limitations**

If the Tauri desktop can be launched in the current environment, create data sets A and B and execute the six Windows checks added to `QA_CHECKLIST.md`.

If desktop interaction is unavailable, record exactly:

```text
Automated restore, rollback, WAL, migration, mutex, and build checks passed.
Interactive Windows Tauri restore and tray-reopen smoke tests were not executed in this headless environment.
```

Do not claim the desktop smoke test passed without performing it.

- [ ] **Step 6: Commit the integration**

Run:

```powershell
git status --short
git add src/pages/DataManagement.tsx README.md docs/PRODUCT_SPEC.md docs/QA_CHECKLIST.md
git commit -m "docs: integrate safe database restore workflow"
```

## Final Review and Completion Gate

- [ ] Generate a review package from the design base through the final implementation commit.
- [ ] Request an independent code review focused on data loss, rollback gaps, SQLite backup lifecycle, Windows locks, staging cleanup, schema compatibility, and misleading UX.
- [ ] Address every Critical or Important finding with a focused regression test.
- [ ] Run fresh verification after the final fix:

```powershell
npm.cmd run test:unit
npm.cmd run check
npm.cmd run build
cd src-tauri
cargo test --locked
cargo check --locked
cargo fmt --check
cd ..
git diff --check
git status --short --branch
```

- [ ] Report commit hashes, exact test totals, skipped desktop checks, remaining risks, and the path of the written design and plan.
