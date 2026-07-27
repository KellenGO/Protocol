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

    let error = restore_database_inner(&live, &live_dir.join("protocol.db")).unwrap_err();

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
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(count > 0, "{table} should survive restore");
    }
    let description: String = conn
        .query_row("SELECT description FROM chains WHERE id = 1", [], |row| {
            row.get(0)
        })
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

    let error = restore_database_inner_with_validator(&live, &backup_path, |_| {
        Err("injected post-copy failure".into())
    })
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

    assert!(acquired_rx
        .recv_timeout(Duration::from_millis(100))
        .is_err());
    release_tx.send(()).unwrap();
    restore_thread.join().unwrap().unwrap();
    acquired_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    query_thread.join().unwrap();
}
