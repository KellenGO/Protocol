use rusqlite::{Connection, Result as SqliteResult};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_dir: PathBuf) -> SqliteResult<Self> {
        fs::create_dir_all(&app_dir).expect("failed to create app data dir");

        let db_path = app_dir.join("protocol.db");
        let conn = Connection::open(db_path)?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        let db = Database {
            conn: Mutex::new(conn),
        };
        db.initialize_schema()?;
        Ok(db)
    }

    fn initialize_schema(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS chains (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                trigger_action TEXT NOT NULL DEFAULT '开始正式任务',
                completion_condition TEXT NOT NULL DEFAULT '',
                focus_duration_minutes INTEGER NOT NULL DEFAULT 25,
                auxiliary_trigger_action TEXT NOT NULL DEFAULT '启动辅助链',
                auxiliary_delay_minutes INTEGER NOT NULL DEFAULT 15,
                auxiliary_completion_condition TEXT NOT NULL DEFAULT '',
                current_length INTEGER NOT NULL DEFAULT 0,
                best_length INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS focus_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chain_id INTEGER NOT NULL,
                started_at TEXT NOT NULL DEFAULT (datetime('now')),
                expected_end_at TEXT,
                ended_at TEXT,
                duration_minutes INTEGER,
                result TEXT CHECK(result IN ('completed', 'failed_reset', 'failed_precedent')),
                failure_note TEXT,
                trigger_action TEXT NOT NULL DEFAULT '',
                completion_condition TEXT NOT NULL DEFAULT '',
                debug_category TEXT,
                debug_note TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (chain_id) REFERENCES chains(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS reservation_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chain_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                due_at TEXT NOT NULL,
                fulfilled_at TEXT,
                result TEXT CHECK(result IN ('fulfilled', 'failed_reset', 'failed_precedent')),
                failure_note TEXT,
                trigger_action TEXT NOT NULL DEFAULT '',
                completion_condition TEXT NOT NULL DEFAULT '',
                debug_category TEXT,
                debug_note TEXT,
                FOREIGN KEY (chain_id) REFERENCES chains(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS precedents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chain_id INTEGER NOT NULL,
                scope TEXT NOT NULL CHECK(scope IN ('main_chain', 'reservation_chain')),
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_from_session_id INTEGER,
                created_from_session_type TEXT CHECK(created_from_session_type IN ('focus', 'reservation')),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (chain_id) REFERENCES chains(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rsip_formulas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_id INTEGER,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('inactive', 'active')),
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                activated_at TEXT,
                deactivated_at TEXT,
                FOREIGN KEY (parent_id) REFERENCES rsip_formulas(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS formula_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                formula_id INTEGER NOT NULL,
                event_type TEXT NOT NULL CHECK(event_type IN ('created', 'activated', 'deactivated', 'rollback_child_deactivated')),
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (formula_id) REFERENCES rsip_formulas(id) ON DELETE CASCADE
            );

            INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_focus_duration', '25');
            INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_reservation_duration', '15');
            INSERT OR IGNORE INTO app_settings (key, value) VALUES ('enable_notifications', 'false');
            ",
        )?;

        migrate_precedents_to_core_schema(&conn)?;
        migrate_protocol_config_schema(&conn)?;

        Ok(())
    }
}

fn table_columns(conn: &Connection, table: &str) -> SqliteResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<SqliteResult<Vec<String>>>()?;
    Ok(columns)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> SqliteResult<()> {
    let columns = table_columns(conn, table)?;
    if columns.iter().any(|existing| existing == column) {
        return Ok(());
    }

    conn.execute_batch(&format!(
        "ALTER TABLE {} ADD COLUMN {} {};",
        table, column, definition
    ))?;
    Ok(())
}

fn migrate_protocol_config_schema(conn: &Connection) -> SqliteResult<()> {
    add_column_if_missing(
        conn,
        "chains",
        "trigger_action",
        "TEXT NOT NULL DEFAULT '开始正式任务'",
    )?;
    add_column_if_missing(
        conn,
        "chains",
        "completion_condition",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        conn,
        "chains",
        "auxiliary_trigger_action",
        "TEXT NOT NULL DEFAULT '启动辅助链'",
    )?;
    add_column_if_missing(
        conn,
        "chains",
        "auxiliary_delay_minutes",
        "INTEGER NOT NULL DEFAULT 15",
    )?;
    add_column_if_missing(
        conn,
        "chains",
        "auxiliary_completion_condition",
        "TEXT NOT NULL DEFAULT ''",
    )?;

    for table in ["focus_sessions", "reservation_sessions"] {
        add_column_if_missing(conn, table, "trigger_action", "TEXT NOT NULL DEFAULT ''")?;
        add_column_if_missing(conn, table, "completion_condition", "TEXT NOT NULL DEFAULT ''")?;
        add_column_if_missing(conn, table, "debug_category", "TEXT")?;
        add_column_if_missing(conn, table, "debug_note", "TEXT")?;
    }

    Ok(())
}

fn migrate_precedents_to_core_schema(conn: &Connection) -> SqliteResult<()> {
    let columns = table_columns(conn, "precedents")?;

    let removed_columns = [
        "category",
        "failure_reason",
        "ruling_note",
        "severity",
        "created_from_context",
    ];

    if !removed_columns.iter().any(|column| columns.iter().any(|existing| existing == column)) {
        return Ok(());
    }

    conn.execute_batch(
        "
        PRAGMA foreign_keys=OFF;
        BEGIN TRANSACTION;
        ALTER TABLE precedents RENAME TO precedents_v2beta_legacy;
        CREATE TABLE precedents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chain_id INTEGER NOT NULL,
            scope TEXT NOT NULL CHECK(scope IN ('main_chain', 'reservation_chain')),
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_from_session_id INTEGER,
            created_from_session_type TEXT CHECK(created_from_session_type IN ('focus', 'reservation')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (chain_id) REFERENCES chains(id) ON DELETE CASCADE
        );
        INSERT INTO precedents (
            id,
            chain_id,
            scope,
            title,
            description,
            created_from_session_id,
            created_from_session_type,
            created_at
        )
        SELECT
            id,
            chain_id,
            scope,
            title,
            description,
            created_from_session_id,
            created_from_session_type,
            created_at
        FROM precedents_v2beta_legacy;
        DROP TABLE precedents_v2beta_legacy;
        COMMIT;
        PRAGMA foreign_keys=ON;
        ",
    )?;

    Ok(())
}
