use super::*;
use rusqlite::backup::StepResult;
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

#[allow(dead_code)]
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
        error.contains("占用") || error.contains("锁") || error.to_lowercase().contains("locked")
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
    let destination_path = create_protocol_database(&test_dir.path().join("destination"));
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

    assert!(error.contains("锁") || error.to_lowercase().contains("locked"));
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

    let destination_path = create_protocol_database(&test_dir.path().join("destination"));
    let mut destination = Connection::open(&destination_path).unwrap();
    destination
        .execute("INSERT INTO chains (name) VALUES ('live-old')", [])
        .unwrap();

    let step = copy_database_snapshot_then_abort(&source, &mut destination, 1).unwrap();

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

    let error = match prepare_restore_staging_from_source(&source, &test_dir.path().join("staging"))
    {
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

    let staging = prepare_restore_staging(&source_path, &test_dir.path().join("staging")).unwrap();

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

    let error = match prepare_restore_staging(&source_path, &test_dir.path().join("staging")) {
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

    cleanup_stale_staging_files(&staging_dir, SystemTime::now(), Duration::ZERO, None).unwrap();

    assert!(!stale.exists());
    assert!(unrelated.exists());
}

#[test]
fn stale_cleanup_preserves_selected_old_task_owned_source() {
    let test_dir = RestoreTestDir::new("staging-stale-selected-source");
    let staging_root = test_dir.path().join("staging-root");
    let staging_dir = staging_root.join(".restore");
    std::fs::create_dir_all(&staging_dir).unwrap();
    let backup_path = create_protocol_backup(&test_dir.path().join("source"));
    let selected_source = staging_dir.join("staging-selected.sqlite");
    std::fs::rename(&backup_path, &selected_source).unwrap();
    let old_modified = SystemTime::now() - Duration::from_secs(8 * 24 * 60 * 60);
    std::fs::File::options()
        .write(true)
        .open(&selected_source)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(old_modified))
        .unwrap();
    let before = std::fs::read(&selected_source).unwrap();

    let mut staging = prepare_restore_staging(&selected_source, &staging_root).unwrap();

    staging.cleanup().unwrap();
    assert!(selected_source.is_file());
    assert_eq!(std::fs::read(&selected_source).unwrap(), before);
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
