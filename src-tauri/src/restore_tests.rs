use super::*;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

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
