mod db;

use db::{initialize_schema_on, Database, CURRENT_DB_VERSION};
use rusqlite::backup::{Backup, StepResult};
use rusqlite::{ffi, Connection, OpenFlags};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex as StdMutex, MutexGuard, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

const PENDING_RULING_NOTE: &str = "__pending_ruling__";
const CHAIN_FIELDS: &str = "id, name, description, trigger_action, completion_condition, focus_duration_minutes, auxiliary_trigger_action, auxiliary_delay_minutes, auxiliary_completion_condition, auxiliary_current_length, auxiliary_best_length, current_length, best_length, status, created_at, updated_at";
const RSIP_FORMULA_FIELDS: &str = "id, parent_id, title, description, status, position, created_at, updated_at, activated_at, deactivated_at, goal_id, failure_path_id, intervention_node_id, dependency_note";
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

static RESTORE_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
static ACTIVE_RESTORE_PREVIEWS: OnceLock<StdMutex<HashMap<PathBuf, RegisteredRestorePreview>>> =
    OnceLock::new();
const RESTORE_DIRECTORY_NAME: &str = ".restore";
const RESTORE_PREVIEW_PREFIX: &str = "restore-preview";
const RESTORE_STAGING_PREFIX: &str = "staging";
const RESTORE_STALE_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FileIdentity {
    volume: u64,
    file: u64,
}

struct RegisteredRestorePreview {
    identity: FileIdentity,
    source: Option<Connection>,
}

fn restore_preview_registry(
) -> Result<MutexGuard<'static, HashMap<PathBuf, RegisteredRestorePreview>>, String> {
    ACTIVE_RESTORE_PREVIEWS
        .get_or_init(|| StdMutex::new(HashMap::new()))
        .lock()
        .map_err(|e| format!("恢复预览注册表不可用: {e}"))
}

fn register_restore_preview(path: &Path, source: Connection) -> Result<(), String> {
    let file = File::open(path).map_err(|e| format!("无法打开任务恢复预览: {e}"))?;
    let identity = file_identity(&file).map_err(|e| format!("无法读取任务恢复预览身份: {e}"))?;
    restore_preview_registry()?.insert(
        path.to_path_buf(),
        RegisteredRestorePreview {
            identity,
            source: Some(source),
        },
    );
    Ok(())
}

fn remove_registered_restore_preview(path: &Path) -> Result<(), String> {
    let preview = restore_preview_registry()?
        .remove(path)
        .ok_or_else(|| "恢复预览不属于当前检查任务".to_string())?;
    let identity = preview.identity;
    drop(preview.source);
    let result = remove_preview_files_with_identity(path, identity);
    if result.is_err() {
        restore_preview_registry()?.insert(
            path.to_path_buf(),
            RegisteredRestorePreview {
                identity,
                source: None,
            },
        );
    }
    result
}

fn registered_restore_preview_identity(path: &Path) -> Result<Option<FileIdentity>, String> {
    Ok(restore_preview_registry()?
        .get(path)
        .map(|preview| preview.identity))
}

#[cfg(unix)]
fn file_identity(file: &File) -> std::io::Result<FileIdentity> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file.metadata()?;
    Ok(FileIdentity {
        volume: metadata.dev(),
        file: metadata.ino(),
    })
}

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct WindowsFileTime {
    dwLowDateTime: u32,
    dwHighDateTime: u32,
}

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct WindowsByHandleFileInformation {
    dwFileAttributes: u32,
    ftCreationTime: WindowsFileTime,
    ftLastAccessTime: WindowsFileTime,
    ftLastWriteTime: WindowsFileTime,
    dwVolumeSerialNumber: u32,
    nFileSizeHigh: u32,
    nFileSizeLow: u32,
    nNumberOfLinks: u32,
    nFileIndexHigh: u32,
    nFileIndexLow: u32,
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetFileInformationByHandle(
        file: *mut std::ffi::c_void,
        information: *mut WindowsByHandleFileInformation,
    ) -> i32;
}

#[cfg(windows)]
fn windows_handle_identity(handle: *mut std::ffi::c_void) -> std::io::Result<FileIdentity> {
    use std::mem::MaybeUninit;

    let mut information = MaybeUninit::<WindowsByHandleFileInformation>::uninit();
    // SAFETY: `handle` is a live owned handle and `information` points to enough
    // writable memory for BY_HANDLE_FILE_INFORMATION.
    let success = unsafe { GetFileInformationByHandle(handle, information.as_mut_ptr()) };
    if success == 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: a successful GetFileInformationByHandle call initialized every
    // field in the output structure.
    let information = unsafe { information.assume_init() };
    Ok(FileIdentity {
        volume: u64::from(information.dwVolumeSerialNumber),
        file: (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
    })
}

#[cfg(windows)]
fn file_identity(file: &File) -> std::io::Result<FileIdentity> {
    use std::os::windows::io::AsRawHandle;

    windows_handle_identity(file.as_raw_handle().cast())
}

#[cfg(not(any(unix, windows)))]
fn file_identity(file: &File) -> std::io::Result<FileIdentity> {
    let metadata = file.metadata()?;
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    Ok(FileIdentity {
        volume: metadata.len(),
        file: modified,
    })
}

fn clean_option(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_string()
}

fn behavior_note(behavior_type: Option<String>) -> Option<String> {
    let value = clean_option(behavior_type);
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn clean_required(value: String, message: &str) -> Result<String, String> {
    let cleaned = value.trim().to_string();
    if cleaned.is_empty() {
        Err(message.to_string())
    } else {
        Ok(cleaned)
    }
}

fn optional_note(value: Option<String>) -> Option<String> {
    let cleaned = clean_option(value);
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn chain_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, i64>(0)?,
        "name": row.get::<_, String>(1)?,
        "description": row.get::<_, String>(2)?,
        "trigger_action": row.get::<_, String>(3)?,
        "completion_condition": row.get::<_, String>(4)?,
        "focus_duration_minutes": row.get::<_, i64>(5)?,
        "auxiliary_trigger_action": row.get::<_, String>(6)?,
        "auxiliary_delay_minutes": row.get::<_, i64>(7)?,
        "auxiliary_completion_condition": row.get::<_, String>(8)?,
        "auxiliary_current_length": row.get::<_, i64>(9)?,
        "auxiliary_best_length": row.get::<_, i64>(10)?,
        "current_length": row.get::<_, i64>(11)?,
        "best_length": row.get::<_, i64>(12)?,
        "status": row.get::<_, String>(13)?,
        "created_at": row.get::<_, String>(14)?,
        "updated_at": row.get::<_, String>(15)?,
    }))
}

fn rsip_formula_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, i64>(0)?,
        "parent_id": row.get::<_, Option<i64>>(1)?,
        "title": row.get::<_, String>(2)?,
        "description": row.get::<_, String>(3)?,
        "status": row.get::<_, String>(4)?,
        "position": row.get::<_, i64>(5)?,
        "created_at": row.get::<_, String>(6)?,
        "updated_at": row.get::<_, String>(7)?,
        "activated_at": row.get::<_, Option<String>>(8)?,
        "deactivated_at": row.get::<_, Option<String>>(9)?,
        "goal_id": row.get::<_, Option<i64>>(10)?,
        "failure_path_id": row.get::<_, Option<i64>>(11)?,
        "intervention_node_id": row.get::<_, Option<String>>(12)?,
        "dependency_note": row.get::<_, Option<String>>(13)?,
    }))
}

fn rsip_goal_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, i64>(0)?,
        "title": row.get::<_, String>(1)?,
        "description": row.get::<_, Option<String>>(2)?,
        "status": row.get::<_, String>(3)?,
        "created_at": row.get::<_, String>(4)?,
        "updated_at": row.get::<_, String>(5)?,
        "archived_at": row.get::<_, Option<String>>(6)?,
        "formula_count": row.get::<_, i64>(7)?,
        "failure_path_count": row.get::<_, i64>(8)?,
    }))
}

fn rsip_failure_path_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, i64>(0)?,
        "goal_id": row.get::<_, i64>(1)?,
        "title": row.get::<_, String>(2)?,
        "nodes_json": row.get::<_, String>(3)?,
        "created_at": row.get::<_, String>(4)?,
        "updated_at": row.get::<_, String>(5)?,
    }))
}

fn formula_event_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, i64>(0)?,
        "formula_id": row.get::<_, i64>(1)?,
        "formula_title": row.get::<_, String>(2)?,
        "event_type": row.get::<_, String>(3)?,
        "note": row.get::<_, String>(4)?,
        "created_at": row.get::<_, String>(5)?,
    }))
}

fn precedent_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, i64>(0)?,
        "chain_id": row.get::<_, i64>(1)?,
        "scope": row.get::<_, String>(2)?,
        "title": row.get::<_, String>(3)?,
        "description": row.get::<_, String>(4)?,
        "created_from_session_id": row.get::<_, Option<i64>>(5)?,
        "created_from_session_type": row.get::<_, Option<String>>(6)?,
        "status": row.get::<_, String>(7)?,
        "created_at": row.get::<_, String>(8)?,
        "updated_at": row.get::<_, Option<String>>(9)?,
        "retired_at": row.get::<_, Option<String>>(10)?,
    }))
}

fn get_chain_json(conn: &rusqlite::Connection, id: i64) -> Result<serde_json::Value, String> {
    conn.query_row(
        &format!("SELECT {} FROM chains WHERE id = ?1", CHAIN_FIELDS),
        [id],
        chain_json,
    )
    .map_err(|e| e.to_string())
}

fn reservation_phase_from_times(
    due_at: &str,
    confirmation_due_at: Option<&str>,
    failure_note: Option<&str>,
    now: &str,
) -> &'static str {
    if failure_note == Some(PENDING_RULING_NOTE) {
        return "pending_ruling";
    }

    if now < due_at {
        "countdown"
    } else {
        let confirmation_due_at = confirmation_due_at.unwrap_or(due_at);
        if now < confirmation_due_at {
            "confirming"
        } else {
            "confirming"
        }
    }
}

fn reservation_failure_is_due(due_at: &str, confirmation_due_at: Option<&str>, now: &str) -> bool {
    now >= confirmation_due_at.unwrap_or(due_at)
}

#[cfg(test)]
fn reservation_result_after_confirmation_deadline() -> (Option<String>, Option<String>) {
    (None, Some(PENDING_RULING_NOTE.to_string()))
}

#[cfg(test)]
fn auxiliary_length_after_reservation_reset_ruling(_current_length: i64) -> i64 {
    0
}

#[cfg(test)]
fn auxiliary_length_after_reservation_precedent_ruling(current_length: i64) -> i64 {
    current_length
}

#[cfg(test)]
fn active_precedent_titles(precedents: Vec<(&str, &str)>) -> Vec<String> {
    precedents
        .into_iter()
        .filter_map(|(title, status)| {
            if status == "active" {
                Some(title.to_string())
            } else {
                None
            }
        })
        .collect()
}

fn clean_rsip_formula_edit(title: &str, description: &str) -> Result<(String, String), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("定式标题不能为空".into());
    }
    Ok((title, description.trim().to_string()))
}

fn clean_rsip_deactivation_note(note: Option<String>) -> String {
    let cleaned = note.unwrap_or_default().trim().to_string();
    if cleaned.is_empty() {
        "用户裁定该定式当前熄灭".to_string()
    } else {
        cleaned
    }
}

fn clean_rsip_goal_input(title: &str, description: &str) -> Result<(String, String), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("goal title cannot be empty".into());
    }
    Ok((title, description.trim().to_string()))
}

fn failure_path_nodes_json(nodes: Vec<String>) -> Result<String, String> {
    let nodes: Vec<serde_json::Value> = nodes
        .into_iter()
        .map(|node| node.trim().to_string())
        .filter(|node| !node.is_empty())
        .enumerate()
        .map(|(index, text)| {
            serde_json::json!({
                "id": format!("node-{}", index + 1),
                "text": text,
            })
        })
        .collect();

    if nodes.is_empty() {
        return Err("failure path requires at least one behavior node".into());
    }

    serde_json::to_string(&nodes).map_err(|e| e.to_string())
}

fn clean_goal_formula_dependency(
    parent_id: Option<i64>,
    dependency_note: Option<String>,
) -> Result<Option<String>, String> {
    let cleaned = dependency_note.unwrap_or_default().trim().to_string();
    if parent_id.is_some() && cleaned.is_empty() {
        return Err("child formulas require a dependency note".into());
    }
    if cleaned.is_empty() {
        Ok(None)
    } else {
        Ok(Some(cleaned))
    }
}

fn ensure_rsip_goal_exists(conn: &rusqlite::Connection, goal_id: i64) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM rsip_goals WHERE id = ?1",
            [goal_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        Ok(())
    } else {
        Err("goal does not exist".into())
    }
}

fn ensure_failure_path_belongs_to_goal(
    conn: &rusqlite::Connection,
    failure_path_id: i64,
    goal_id: i64,
) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM rsip_failure_paths WHERE id = ?1 AND goal_id = ?2",
            rusqlite::params![failure_path_id, goal_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        Ok(())
    } else {
        Err("failure path does not belong to the goal".into())
    }
}

fn next_rsip_formula_position(
    conn: &rusqlite::Connection,
    parent_id: Option<i64>,
) -> Result<i64, String> {
    if let Some(pid) = parent_id {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM rsip_formulas WHERE parent_id = ?1",
            [pid],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM rsip_formulas WHERE parent_id IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
    }
}

fn get_rsip_formula_json(
    conn: &rusqlite::Connection,
    id: i64,
) -> Result<serde_json::Value, String> {
    conn.query_row(
        &format!("SELECT {} FROM rsip_formulas WHERE id = ?1", RSIP_FORMULA_FIELDS),
        [id],
        rsip_formula_json,
    )
    .map_err(|e| e.to_string())
}

fn get_rsip_goal_record(
    conn: &rusqlite::Connection,
    id: i64,
) -> Result<serde_json::Value, String> {
    conn.query_row(
        "SELECT g.id, g.title, g.description, g.status, g.created_at, g.updated_at, g.archived_at,
                COUNT(DISTINCT f.id) AS formula_count,
                COUNT(DISTINCT p.id) AS failure_path_count
         FROM rsip_goals g
         LEFT JOIN rsip_formulas f ON f.goal_id = g.id
         LEFT JOIN rsip_failure_paths p ON p.goal_id = g.id
         WHERE g.id = ?1
         GROUP BY g.id",
        [id],
        rsip_goal_json,
    )
    .map_err(|e| e.to_string())
}

fn insert_rsip_goal_record(
    conn: &rusqlite::Connection,
    title: &str,
    description: &str,
) -> Result<i64, String> {
    let (title, description) = clean_rsip_goal_input(title, description)?;
    conn.execute(
        "INSERT INTO rsip_goals (title, description) VALUES (?1, ?2)",
        rusqlite::params![title, description],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

fn insert_failure_path_record(
    conn: &rusqlite::Connection,
    goal_id: i64,
    title: &str,
    nodes: Vec<String>,
) -> Result<i64, String> {
    ensure_rsip_goal_exists(conn, goal_id)?;
    let title = title.trim();
    if title.is_empty() {
        return Err("failure path title cannot be empty".into());
    }
    let nodes_json = failure_path_nodes_json(nodes)?;
    conn.execute(
        "INSERT INTO rsip_failure_paths (goal_id, title, nodes_json) VALUES (?1, ?2, ?3)",
        rusqlite::params![goal_id, title, nodes_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

fn insert_goal_formula_record(
    conn: &rusqlite::Connection,
    goal_id: i64,
    failure_path_id: i64,
    intervention_node_id: String,
    title: String,
    description: String,
    parent_id: Option<i64>,
    dependency_note: Option<String>,
) -> Result<serde_json::Value, String> {
    ensure_rsip_goal_exists(conn, goal_id)?;
    ensure_failure_path_belongs_to_goal(conn, failure_path_id, goal_id)?;
    if let Some(pid) = parent_id {
        let parent_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM rsip_formulas WHERE id = ?1",
                [pid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !parent_exists {
            return Err("parent formula does not exist".into());
        }
    }

    let intervention_node_id = intervention_node_id.trim().to_string();
    if intervention_node_id.is_empty() {
        return Err("intervention node cannot be empty".into());
    }

    let (title, description) = clean_rsip_formula_edit(&title, &description)?;
    let dependency_note = clean_goal_formula_dependency(parent_id, dependency_note)?;
    let next_position = next_rsip_formula_position(conn, parent_id)?;

    conn.execute(
        "INSERT INTO rsip_formulas (
            parent_id, title, description, position, goal_id, failure_path_id, intervention_node_id, dependency_note
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            parent_id,
            title,
            description,
            next_position,
            goal_id,
            failure_path_id,
            intervention_node_id,
            dependency_note
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO formula_events (formula_id, event_type, note) VALUES (?1, 'created', ?2)",
        rusqlite::params![id, "Formula created from goal translation"],
    )
    .map_err(|e| e.to_string())?;

    get_rsip_formula_json(conn, id)
}

fn get_goal_formula_records(
    conn: &rusqlite::Connection,
    goal_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    ensure_rsip_goal_exists(conn, goal_id)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {}
             FROM rsip_formulas
             WHERE goal_id = ?1
             ORDER BY COALESCE(parent_id, 0), position, created_at",
            RSIP_FORMULA_FIELDS
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([goal_id], rsip_formula_json)
        .map_err(|e| e.to_string())?;

    let mut formulas = Vec::new();
    for row in rows {
        formulas.push(row.map_err(|e| e.to_string())?);
    }
    Ok(formulas)
}

fn get_auxiliary_confirmation_window_minutes(conn: &rusqlite::Connection) -> Result<i64, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'auxiliary_confirmation_window_minutes'",
            [],
            |row| row.get(0),
        )
        .ok();

    let parsed = value
        .as_deref()
        .unwrap_or("3")
        .trim()
        .parse::<i64>()
        .unwrap_or(3);
    Ok(parsed.clamp(1, 60))
}

fn expire_overdue_reservation_sessions(conn: &rusqlite::Connection) -> Result<usize, String> {
    conn.execute(
        "UPDATE reservation_sessions
         SET failure_note = ?1,
             debug_category = NULL,
             debug_note = NULL
         WHERE result IS NULL
           AND (failure_note IS NULL OR failure_note != ?1)
           AND datetime(COALESCE(confirmation_due_at, due_at)) <= datetime('now')",
        [PENDING_RULING_NOTE],
    )
    .map_err(|e| e.to_string())
}

fn reservation_failure_result_json(
    conn: &rusqlite::Connection,
    reservation_id: i64,
    chain_id: i64,
) -> Result<serde_json::Value, String> {
    let session = conn.query_row(
        "SELECT id, chain_id, created_at, due_at, confirmation_due_at, fulfilled_at, result, failure_note, trigger_action, completion_condition, debug_category, debug_note FROM reservation_sessions WHERE id = ?1",
        [reservation_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
                "confirmation_due_at": row.get::<_, Option<String>>(4)?,
                "fulfilled_at": row.get::<_, Option<String>>(5)?,
                "result": row.get::<_, Option<String>>(6)?,
                "failure_note": row.get::<_, Option<String>>(7)?,
                "trigger_action": row.get::<_, String>(8)?,
                "completion_condition": row.get::<_, String>(9)?,
                "debug_category": row.get::<_, Option<String>>(10)?,
                "debug_note": row.get::<_, Option<String>>(11)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let chain = get_chain_json(conn, chain_id)?;

    Ok(serde_json::json!({
        "session": session,
        "chain": chain,
    }))
}

fn expire_reservation_session_by_id(
    conn: &rusqlite::Connection,
    reservation_id: i64,
) -> Result<serde_json::Value, String> {
    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM reservation_sessions WHERE id = ?1 AND result IS NULL",
            [reservation_id],
            |row| row.get(0),
        )
        .map_err(|_| "辅助链不存在或已结束".to_string())?;

    let rows = conn
        .execute(
            "UPDATE reservation_sessions
             SET failure_note = ?2,
                 debug_category = NULL,
                 debug_note = NULL
             WHERE id = ?1 AND result IS NULL AND datetime(COALESCE(confirmation_due_at, due_at)) <= datetime('now')",
            rusqlite::params![reservation_id, PENDING_RULING_NOTE],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("辅助链确认窗口尚未结束".into());
    }

    reservation_failure_result_json(conn, reservation_id, chain_id)
}

fn prepare_reservation_ruling(
    conn: &rusqlite::Connection,
    reservation_id: i64,
) -> Result<i64, String> {
    let (chain_id, due_at, confirmation_due_at, failure_note, now): (
        i64,
        String,
        Option<String>,
        Option<String>,
        String,
    ) = conn
        .query_row(
            "SELECT chain_id, due_at, confirmation_due_at, failure_note, datetime('now')
             FROM reservation_sessions
             WHERE id = ?1 AND result IS NULL",
            [reservation_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|_| "辅助链不存在或已结束".to_string())?;

    if failure_note.as_deref() == Some(PENDING_RULING_NOTE) {
        return Ok(chain_id);
    }

    if !reservation_failure_is_due(&due_at, confirmation_due_at.as_deref(), &now) {
        return Err("辅助链确认窗口尚未结束".into());
    }

    conn.execute(
        "UPDATE reservation_sessions
         SET failure_note = ?2,
             debug_category = NULL,
             debug_note = NULL
         WHERE id = ?1 AND result IS NULL",
        rusqlite::params![reservation_id, PENDING_RULING_NOTE],
    )
    .map_err(|e| e.to_string())?;

    Ok(chain_id)
}

#[tauri::command]
fn create_chain(
    state: tauri::State<'_, Database>,
    name: String,
    description: String,
    trigger_action: String,
    completion_condition: String,
    focus_duration_minutes: i64,
    auxiliary_trigger_action: String,
    auxiliary_delay_minutes: i64,
    auxiliary_completion_condition: String,
) -> Result<serde_json::Value, String> {
    let name = clean_required(name, "链名称不能为空")?;
    let trigger_action = clean_required(trigger_action, "触发动作不能为空")?;
    let completion_condition = clean_required(completion_condition, "完成条件不能为空")?;
    let auxiliary_trigger_action =
        clean_required(auxiliary_trigger_action, "辅助链触发动作不能为空")?;
    let auxiliary_completion_condition =
        clean_required(auxiliary_completion_condition, "辅助链完成条件不能为空")?;
    if focus_duration_minutes < 1 {
        return Err("专注时长必须为正整数".into());
    }
    if auxiliary_delay_minutes < 1 {
        return Err("辅助链预约时间必须为正整数".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chains (
            name, description, trigger_action, completion_condition, focus_duration_minutes,
            auxiliary_trigger_action, auxiliary_delay_minutes, auxiliary_completion_condition
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            name,
            description.trim(),
            trigger_action,
            completion_condition,
            focus_duration_minutes,
            auxiliary_trigger_action,
            auxiliary_delay_minutes,
            auxiliary_completion_condition
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    get_chain_json(&conn, id)
}

#[tauri::command]
fn update_chain(
    state: tauri::State<'_, Database>,
    id: i64,
    name: String,
    description: String,
    trigger_action: String,
    completion_condition: String,
    focus_duration_minutes: i64,
    auxiliary_trigger_action: String,
    auxiliary_delay_minutes: i64,
    auxiliary_completion_condition: String,
) -> Result<serde_json::Value, String> {
    let name = clean_required(name, "主链名称不能为空")?;
    let trigger_action = clean_required(trigger_action, "触发动作不能为空")?;
    let completion_condition = clean_required(completion_condition, "完成条件不能为空")?;
    let auxiliary_trigger_action =
        clean_required(auxiliary_trigger_action, "辅助链触发动作不能为空")?;
    let auxiliary_completion_condition =
        clean_required(auxiliary_completion_condition, "辅助链完成条件不能为空")?;
    if focus_duration_minutes < 1 {
        return Err("专注时长必须为正整数".into());
    }
    if auxiliary_delay_minutes < 1 {
        return Err("辅助链预约时间必须为正整数".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let rows = conn
        .execute(
            "UPDATE chains
             SET name = ?1,
                 description = ?2,
                 trigger_action = ?3,
                 completion_condition = ?4,
                 focus_duration_minutes = ?5,
                 auxiliary_trigger_action = ?6,
                 auxiliary_delay_minutes = ?7,
                 auxiliary_completion_condition = ?8,
                 updated_at = datetime('now')
             WHERE id = ?9",
            rusqlite::params![
                name,
                description.trim(),
                trigger_action,
                completion_condition,
                focus_duration_minutes,
                auxiliary_trigger_action,
                auxiliary_delay_minutes,
                auxiliary_completion_condition,
                id
            ],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("链不存在".into());
    }

    get_chain_json(&conn, id)
}

#[tauri::command]
fn get_chain(state: tauri::State<'_, Database>, id: i64) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    get_chain_json(&conn, id)
}

#[tauri::command]
fn get_chains(state: tauri::State<'_, Database>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM chains ORDER BY created_at DESC",
            CHAIN_FIELDS
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], chain_json).map_err(|e| e.to_string())?;

    let mut chains = Vec::new();
    for row in rows {
        chains.push(row.map_err(|e| e.to_string())?);
    }
    Ok(chains)
}

#[tauri::command]
fn get_global_active_focus_session(
    state: tauri::State<'_, Database>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let result = conn
        .query_row(
            "SELECT f.id, f.chain_id, f.started_at, f.expected_end_at, f.duration_minutes, c.name as chain_name, f.failure_note, f.trigger_action, f.completion_condition
             FROM focus_sessions f
             JOIN chains c ON c.id = f.chain_id
             WHERE f.result IS NULL
             ORDER BY f.started_at DESC LIMIT 1",
            [],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "chain_id": row.get::<_, i64>(1)?,
                    "started_at": row.get::<_, String>(2)?,
                    "expected_end_at": row.get::<_, Option<String>>(3)?,
                    "duration_minutes": row.get::<_, Option<i64>>(4)?,
                    "chain_name": row.get::<_, String>(5)?,
                    "pending_ruling": row.get::<_, Option<String>>(6)?.as_deref() == Some(PENDING_RULING_NOTE),
                    "trigger_action": row.get::<_, String>(7)?,
                    "completion_condition": row.get::<_, String>(8)?,
                }))
            },
        )
        .ok();
    Ok(result)
}

#[tauri::command]
fn set_focus_session_pending_ruling(
    state: tauri::State<'_, Database>,
    session_id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let rows = conn
        .execute(
            "UPDATE focus_sessions SET failure_note = ?2 WHERE id = ?1 AND result IS NULL",
            rusqlite::params![session_id, PENDING_RULING_NOTE],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("focus session is not active".into());
    }
    Ok(())
}

#[tauri::command]
fn clear_focus_session_pending_ruling(
    state: tauri::State<'_, Database>,
    session_id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE focus_sessions SET failure_note = NULL WHERE id = ?1 AND result IS NULL AND failure_note = ?2",
        rusqlite::params![session_id, PENDING_RULING_NOTE],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn start_focus_session(
    state: tauri::State<'_, Database>,
    chain_id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    expire_overdue_reservation_sessions(&conn)?;

    let (duration_minutes, trigger_action, completion_condition): (i64, String, String) = conn
        .query_row(
            "SELECT focus_duration_minutes, trigger_action, completion_condition FROM chains WHERE id = ?1",
            [chain_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "链不存在".to_string())?;

    let global_active: Option<(i64, String)> = conn
        .query_row(
            "SELECT f.chain_id, c.name FROM focus_sessions f JOIN chains c ON c.id = f.chain_id WHERE f.result IS NULL LIMIT 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();

    if let Some((_active_chain_id, active_chain_name)) = global_active {
        return Err(format!(
            "全局已有进行中的正式任务（链：{}）。请先完成或结束当前任务。",
            active_chain_name
        ));
    }

    let global_reservation: Option<String> = conn
        .query_row(
            "SELECT c.name FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id WHERE r.result IS NULL LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(res_chain_name) = global_reservation {
        return Err(format!(
            "当前已有进行中的预约（链：{}）。请先处理该预约，再开始正式任务。",
            res_chain_name
        ));
    }

    conn.execute(
        "INSERT INTO focus_sessions (
            chain_id, started_at, expected_end_at, duration_minutes, trigger_action, completion_condition
        ) VALUES (?1, datetime('now'), datetime('now', ?2), ?3, ?4, ?5)",
        rusqlite::params![
            chain_id,
            format!("+{} minutes", duration_minutes),
            duration_minutes,
            trigger_action,
            completion_condition
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, chain_id, started_at, expected_end_at, duration_minutes, trigger_action, completion_condition FROM focus_sessions WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "started_at": row.get::<_, String>(2)?,
                "expected_end_at": row.get::<_, Option<String>>(3)?,
                "duration_minutes": row.get::<_, Option<i64>>(4)?,
                "trigger_action": row.get::<_, String>(5)?,
                "completion_condition": row.get::<_, String>(6)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_active_focus_session(
    state: tauri::State<'_, Database>,
    chain_id: i64,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let result = conn
        .query_row(
            "SELECT id, chain_id, started_at, expected_end_at, duration_minutes, trigger_action, completion_condition
             FROM focus_sessions
             WHERE chain_id = ?1 AND result IS NULL
             ORDER BY started_at DESC LIMIT 1",
            [chain_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "chain_id": row.get::<_, i64>(1)?,
                    "started_at": row.get::<_, String>(2)?,
                    "expected_end_at": row.get::<_, Option<String>>(3)?,
                    "duration_minutes": row.get::<_, Option<i64>>(4)?,
                    "trigger_action": row.get::<_, String>(5)?,
                    "completion_condition": row.get::<_, String>(6)?,
                }))
            },
        )
        .ok();
    Ok(result)
}

#[tauri::command]
fn complete_focus_session(
    state: tauri::State<'_, Database>,
    session_id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM focus_sessions WHERE id = ?1 AND result IS NULL",
            [session_id],
            |row| row.get(0),
        )
        .map_err(|_| "任务不存在或已完成".to_string())?;

    conn.execute(
        "UPDATE focus_sessions SET result = 'completed', ended_at = datetime('now') WHERE id = ?1",
        [session_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE chains SET current_length = current_length + 1, updated_at = datetime('now') WHERE id = ?1",
        [chain_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE chains SET best_length = current_length WHERE id = ?1 AND current_length > best_length",
        [chain_id],
    )
    .map_err(|e| e.to_string())?;

    let session = conn
        .query_row(
            "SELECT id, chain_id, started_at, expected_end_at, ended_at, duration_minutes, result, failure_note, trigger_action, completion_condition, debug_category, debug_note, created_at FROM focus_sessions WHERE id = ?1",
            [session_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "chain_id": row.get::<_, i64>(1)?,
                    "started_at": row.get::<_, String>(2)?,
                    "expected_end_at": row.get::<_, Option<String>>(3)?,
                    "ended_at": row.get::<_, Option<String>>(4)?,
                    "duration_minutes": row.get::<_, Option<i64>>(5)?,
                    "result": row.get::<_, Option<String>>(6)?,
                    "failure_note": row.get::<_, Option<String>>(7)?,
                    "trigger_action": row.get::<_, String>(8)?,
                    "completion_condition": row.get::<_, String>(9)?,
                    "debug_category": row.get::<_, Option<String>>(10)?,
                    "debug_note": row.get::<_, Option<String>>(11)?,
                    "created_at": row.get::<_, String>(12)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    let chain = get_chain_json(&conn, chain_id)?;

    Ok(serde_json::json!({
        "session": session,
        "chain": chain,
    }))
}

#[tauri::command]
fn fail_focus_session_reset(
    state: tauri::State<'_, Database>,
    session_id: i64,
    behavior_type: Option<String>,
    debug_category: Option<String>,
    debug_note: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let failure_note = behavior_note(behavior_type);
    let debug_category = optional_note(debug_category);
    let debug_note = optional_note(debug_note);

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM focus_sessions WHERE id = ?1 AND result IS NULL",
            [session_id],
            |row| row.get(0),
        )
        .map_err(|_| "任务不存在或已结束".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE focus_sessions
         SET result = 'failed_reset',
             ended_at = datetime('now'),
             failure_note = ?2,
             debug_category = ?3,
             debug_note = ?4
         WHERE id = ?1",
        rusqlite::params![session_id, failure_note, debug_category, debug_note],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE chains SET current_length = 0, updated_at = datetime('now') WHERE id = ?1",
        [chain_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let session = conn.query_row(
        "SELECT id, chain_id, started_at, expected_end_at, ended_at, duration_minutes, result, failure_note, created_at, trigger_action, completion_condition, debug_category, debug_note FROM focus_sessions WHERE id = ?1",
        [session_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "started_at": row.get::<_, String>(2)?,
                "expected_end_at": row.get::<_, Option<String>>(3)?,
                "ended_at": row.get::<_, Option<String>>(4)?,
                "duration_minutes": row.get::<_, Option<i64>>(5)?,
                "result": row.get::<_, Option<String>>(6)?,
                "failure_note": row.get::<_, Option<String>>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "trigger_action": row.get::<_, String>(9)?,
                "completion_condition": row.get::<_, String>(10)?,
                "debug_category": row.get::<_, Option<String>>(11)?,
                "debug_note": row.get::<_, Option<String>>(12)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let chain = get_chain_json(&conn, chain_id)?;

    Ok(serde_json::json!({
        "session": session,
        "chain": chain,
    }))
}

#[tauri::command]
fn fail_focus_session_precedent(
    state: tauri::State<'_, Database>,
    session_id: i64,
    title: String,
    description: String,
    debug_category: Option<String>,
    debug_note: Option<String>,
) -> Result<serde_json::Value, String> {
    if title.trim().is_empty() {
        return Err("判例标题不能为空".into());
    }

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let failure_note = Some(title.trim().to_string());
    let debug_category = optional_note(debug_category);
    let debug_note = optional_note(debug_note);

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM focus_sessions WHERE id = ?1 AND result IS NULL",
            [session_id],
            |row| row.get(0),
        )
        .map_err(|_| "任务不存在或已结束".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE focus_sessions
         SET result = 'failed_precedent',
             ended_at = datetime('now'),
             failure_note = ?2,
             debug_category = ?3,
             debug_note = ?4
         WHERE id = ?1",
        rusqlite::params![session_id, failure_note, debug_category, debug_note],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO precedents (chain_id, scope, title, description, created_from_session_id, created_from_session_type, updated_at) VALUES (?1, 'main_chain', ?2, ?3, ?4, 'focus', datetime('now'))",
        rusqlite::params![chain_id, title.trim(), description.trim(), session_id],
    )
    .map_err(|e| e.to_string())?;

    let precedent_id = tx.last_insert_rowid();

    tx.commit().map_err(|e| e.to_string())?;

    let session = conn.query_row(
        "SELECT id, chain_id, started_at, expected_end_at, ended_at, duration_minutes, result, failure_note, created_at, trigger_action, completion_condition, debug_category, debug_note FROM focus_sessions WHERE id = ?1",
        [session_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "started_at": row.get::<_, String>(2)?,
                "expected_end_at": row.get::<_, Option<String>>(3)?,
                "ended_at": row.get::<_, Option<String>>(4)?,
                "duration_minutes": row.get::<_, Option<i64>>(5)?,
                "result": row.get::<_, Option<String>>(6)?,
                "failure_note": row.get::<_, Option<String>>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "trigger_action": row.get::<_, String>(9)?,
                "completion_condition": row.get::<_, String>(10)?,
                "debug_category": row.get::<_, Option<String>>(11)?,
                "debug_note": row.get::<_, Option<String>>(12)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let chain = get_chain_json(&conn, chain_id)?;

    let precedent = conn.query_row(
        "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents WHERE id = ?1",
        [precedent_id],
        precedent_json,
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "session": session,
        "chain": chain,
        "precedent": precedent,
    }))
}

#[tauri::command]
fn fail_reservation_session_reset(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
    behavior_type: Option<String>,
    debug_category: Option<String>,
    debug_note: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let failure_note = behavior_note(behavior_type);
    let debug_category = optional_note(debug_category);
    let debug_note = optional_note(debug_note);

    let chain_id = prepare_reservation_ruling(&conn, reservation_id)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let rows = tx
        .execute(
            "UPDATE reservation_sessions
         SET result = 'failed_reset',
             failure_note = ?2,
             debug_category = ?3,
             debug_note = ?4
         WHERE id = ?1 AND result IS NULL AND failure_note = ?5",
            rusqlite::params![
                reservation_id,
                failure_note,
                debug_category,
                debug_note,
                PENDING_RULING_NOTE
            ],
        )
        .map_err(|e| e.to_string())?;
    if rows == 0 {
        return Err("辅助链不存在或已结束".into());
    }

    tx.execute(
        "UPDATE chains
         SET auxiliary_current_length = 0,
             updated_at = datetime('now')
         WHERE id = ?1",
        [chain_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    reservation_failure_result_json(&conn, reservation_id, chain_id)
}

#[tauri::command]
fn fail_reservation_session_precedent(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
    title: String,
    description: String,
    debug_category: Option<String>,
    debug_note: Option<String>,
) -> Result<serde_json::Value, String> {
    if title.trim().is_empty() {
        return Err("判例标题不能为空".into());
    }

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let failure_note = Some(title.trim().to_string());
    let debug_category = optional_note(debug_category);
    let debug_note = optional_note(debug_note);

    let chain_id = prepare_reservation_ruling(&conn, reservation_id)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let rows = tx
        .execute(
            "UPDATE reservation_sessions
         SET result = 'failed_precedent',
             failure_note = ?2,
             debug_category = ?3,
             debug_note = ?4
         WHERE id = ?1 AND result IS NULL AND failure_note = ?5",
            rusqlite::params![
                reservation_id,
                failure_note,
                debug_category,
                debug_note,
                PENDING_RULING_NOTE
            ],
        )
        .map_err(|e| e.to_string())?;
    if rows == 0 {
        return Err("辅助链不存在或已结束".into());
    }

    tx.execute(
        "INSERT INTO precedents (chain_id, scope, title, description, created_from_session_id, created_from_session_type, updated_at) VALUES (?1, 'reservation_chain', ?2, ?3, ?4, 'reservation', datetime('now'))",
        rusqlite::params![chain_id, title.trim(), description.trim(), reservation_id],
    )
    .map_err(|e| e.to_string())?;
    let precedent_id = tx.last_insert_rowid();

    tx.commit().map_err(|e| e.to_string())?;

    let base = reservation_failure_result_json(&conn, reservation_id, chain_id)?;
    let precedent = conn
        .query_row(
            "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents WHERE id = ?1",
            [precedent_id],
            precedent_json,
        )
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "session": base["session"].clone(),
        "chain": base["chain"].clone(),
        "precedent": precedent,
    }))
}

#[tauri::command]
fn get_chain_precedents(
    state: tauri::State<'_, Database>,
    chain_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents WHERE chain_id = ?1 AND scope = 'main_chain' AND status = 'active' ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([chain_id], precedent_json)
        .map_err(|e| e.to_string())?;

    let mut precedents = Vec::new();
    for row in rows {
        precedents.push(row.map_err(|e| e.to_string())?);
    }
    Ok(precedents)
}

#[tauri::command]
fn get_chain_reservation_precedents(
    state: tauri::State<'_, Database>,
    chain_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents WHERE chain_id = ?1 AND scope = 'reservation_chain' AND status = 'active' ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([chain_id], precedent_json)
        .map_err(|e| e.to_string())?;

    let mut precedents = Vec::new();
    for row in rows {
        precedents.push(row.map_err(|e| e.to_string())?);
    }
    Ok(precedents)
}

#[tauri::command]
fn get_precedent(state: tauri::State<'_, Database>, id: i64) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents WHERE id = ?1",
        [id],
        precedent_json,
    )
    .map_err(|_| "判例不存在".to_string())
}

fn ensure_precedent_can_update(conn: &rusqlite::Connection, id: i64) -> Result<(), String> {
    let status: String = conn
        .query_row("SELECT status FROM precedents WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .map_err(|_| "判例不存在".to_string())?;

    if status == "retired" {
        return Err("已废止判例不能编辑".into());
    }

    Ok(())
}

fn get_precedent_record(conn: &rusqlite::Connection, id: i64) -> Result<serde_json::Value, String> {
    conn.query_row(
        "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents WHERE id = ?1",
        [id],
        precedent_json,
    )
    .map_err(|_| "判例不存在".to_string())
}

fn retire_precedent_record(
    conn: &rusqlite::Connection,
    id: i64,
) -> Result<serde_json::Value, String> {
    let status: String = conn
        .query_row("SELECT status FROM precedents WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .map_err(|_| "判例不存在".to_string())?;

    if status == "retired" {
        return get_precedent_record(conn, id);
    }

    conn.execute(
        "UPDATE precedents
         SET status = 'retired',
             retired_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?1 AND status = 'active'",
        [id],
    )
    .map_err(|e| e.to_string())?;

    get_precedent_record(conn, id)
}

#[tauri::command]
fn update_precedent(
    state: tauri::State<'_, Database>,
    id: i64,
    title: String,
    description: String,
) -> Result<serde_json::Value, String> {
    let title = clean_required(title, "判例标题不能为空")?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    ensure_precedent_can_update(&conn, id)?;
    let rows = conn
        .execute(
            "UPDATE precedents
             SET title = ?2,
                 description = ?3,
                 updated_at = datetime('now')
             WHERE id = ?1 AND status = 'active'",
            rusqlite::params![id, title, description.trim()],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("判例不存在".into());
    }

    conn.query_row(
        "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents WHERE id = ?1",
        [id],
        precedent_json,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn retire_precedent(
    state: tauri::State<'_, Database>,
    id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    retire_precedent_record(&conn, id)
}

#[tauri::command]
fn get_global_active_reservation_session(
    state: tauri::State<'_, Database>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    expire_overdue_reservation_sessions(&conn)?;
    let result = conn
        .query_row(
            "SELECT r.id, r.chain_id, r.created_at, r.due_at, r.confirmation_due_at, c.name as chain_name, r.failure_note, r.trigger_action, r.completion_condition, datetime('now')
             FROM reservation_sessions r
             JOIN chains c ON c.id = r.chain_id
             WHERE r.result IS NULL
             ORDER BY r.created_at DESC LIMIT 1",
            [],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "chain_id": row.get::<_, i64>(1)?,
                    "created_at": row.get::<_, String>(2)?,
                    "due_at": row.get::<_, String>(3)?,
                    "confirmation_due_at": row.get::<_, Option<String>>(4)?,
                    "chain_name": row.get::<_, String>(5)?,
                    "pending_ruling": row.get::<_, Option<String>>(6)?.as_deref() == Some(PENDING_RULING_NOTE),
                    "phase": reservation_phase_from_times(
                        row.get::<_, String>(3)?.as_str(),
                        row.get::<_, Option<String>>(4)?.as_deref(),
                        row.get::<_, Option<String>>(6)?.as_deref(),
                        row.get::<_, String>(9)?.as_str(),
                    ),
                    "trigger_action": row.get::<_, String>(7)?,
                    "completion_condition": row.get::<_, String>(8)?,
                }))
            },
        )
        .ok();
    Ok(result)
}

#[tauri::command]
fn start_reservation_session(
    state: tauri::State<'_, Database>,
    chain_id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    expire_overdue_reservation_sessions(&conn)?;

    let (delay_minutes, trigger_action, completion_condition): (i64, String, String) = conn
        .query_row(
            "SELECT auxiliary_delay_minutes, auxiliary_trigger_action, auxiliary_completion_condition FROM chains WHERE id = ?1",
            [chain_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "链不存在".to_string())?;
    let confirmation_minutes = get_auxiliary_confirmation_window_minutes(&conn)?;

    let global_active: Option<(i64, String)> = conn
        .query_row(
            "SELECT r.chain_id, c.name FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id WHERE r.result IS NULL LIMIT 1",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();

    if let Some((_active_chain_id, active_chain_name)) = global_active {
        return Err(format!(
            "全局已有进行中的预约（链：{}）。请先处理当前预约。",
            active_chain_name
        ));
    }

    let global_focus: Option<String> = conn
        .query_row(
            "SELECT c.name FROM focus_sessions f JOIN chains c ON c.id = f.chain_id WHERE f.result IS NULL LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(focus_chain_name) = global_focus {
        return Err(format!(
            "当前已有进行中的正式任务（链：{}）。请先完成或结束该任务，再创建预约。",
            focus_chain_name
        ));
    }

    conn.execute(
        "INSERT INTO reservation_sessions (chain_id, due_at, confirmation_due_at, trigger_action, completion_condition)
         VALUES (?1, datetime('now', ?2), datetime('now', ?2, ?5), ?3, ?4)",
        rusqlite::params![
            chain_id,
            format!("+{} minutes", delay_minutes),
            trigger_action,
            completion_condition,
            format!("+{} minutes", confirmation_minutes)
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, chain_id, created_at, due_at, confirmation_due_at, trigger_action, completion_condition FROM reservation_sessions WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
                "confirmation_due_at": row.get::<_, Option<String>>(4)?,
                "phase": "countdown",
                "trigger_action": row.get::<_, String>(5)?,
                "completion_condition": row.get::<_, String>(6)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn fulfill_reservation_and_start_focus(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
) -> Result<serde_json::Value, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    let (chain_id, focus_dur, trigger_action, completion_condition, due_at, confirmation_due_at, now): (i64, i64, String, String, String, Option<String>, String) = conn
        .query_row(
            "SELECT r.chain_id, c.focus_duration_minutes, c.trigger_action, c.completion_condition, r.due_at, r.confirmation_due_at, datetime('now')
             FROM reservation_sessions r
             JOIN chains c ON c.id = r.chain_id
             WHERE r.id = ?1 AND r.result IS NULL",
            [reservation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        )
        .map_err(|_| "辅助链不存在或已结束".to_string())?;

    if reservation_failure_is_due(&due_at, confirmation_due_at.as_deref(), &now) {
        let _ = expire_reservation_session_by_id(&conn, reservation_id)?;
        return Err("辅助链确认窗口已结束，已自动记录失败".into());
    }

    let has_active_focus: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM focus_sessions WHERE chain_id = ?1 AND result IS NULL",
            [chain_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Safety: check there's no active focus on a *different* chain
    let other_focus: Option<i64> = conn
        .query_row(
            "SELECT chain_id FROM focus_sessions WHERE chain_id != ?1 AND result IS NULL LIMIT 1",
            [chain_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(other_chain_id) = other_focus {
        return Err(format!(
            "全局已有链 {} 的进行中正式任务，不应同时存在 active 预约。此状态不应出现，请先手动结束该任务。",
            other_chain_id
        ));
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE reservation_sessions SET result = 'fulfilled', fulfilled_at = datetime('now') WHERE id = ?1",
        [reservation_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE chains
         SET auxiliary_current_length = auxiliary_current_length + 1,
             updated_at = datetime('now')
         WHERE id = ?1",
        [chain_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE chains
         SET auxiliary_best_length = auxiliary_current_length
         WHERE id = ?1 AND auxiliary_current_length > auxiliary_best_length",
        [chain_id],
    )
    .map_err(|e| e.to_string())?;

    let focus_id: i64 = if has_active_focus {
        tx.query_row(
            "SELECT id FROM focus_sessions WHERE chain_id = ?1 AND result IS NULL ORDER BY started_at DESC LIMIT 1",
            [chain_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        tx.execute(
            "INSERT INTO focus_sessions (
                chain_id, started_at, expected_end_at, duration_minutes, trigger_action, completion_condition
            ) VALUES (?1, datetime('now'), datetime('now', ?2), ?3, ?4, ?5)",
            rusqlite::params![
                chain_id,
                format!("+{} minutes", focus_dur),
                focus_dur,
                trigger_action,
                completion_condition
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.last_insert_rowid()
    };

    tx.commit().map_err(|e| e.to_string())?;

    let focus_session = conn.query_row(
        "SELECT id, chain_id, started_at, expected_end_at, duration_minutes, trigger_action, completion_condition FROM focus_sessions WHERE id = ?1",
        [focus_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "started_at": row.get::<_, String>(2)?,
                "expected_end_at": row.get::<_, Option<String>>(3)?,
                "duration_minutes": row.get::<_, Option<i64>>(4)?,
                "trigger_action": row.get::<_, String>(5)?,
                "completion_condition": row.get::<_, String>(6)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "focus_session": focus_session,
        "chain_id": chain_id,
    }))
}

#[tauri::command]
fn expire_reservation_session(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    expire_reservation_session_by_id(&conn, reservation_id)
}
#[tauri::command]
fn get_app_settings(state: tauri::State<'_, Database>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings ORDER BY key")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "key": row.get::<_, String>(0)?,
                "value": row.get::<_, String>(1)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut settings = Vec::new();
    for row in rows {
        settings.push(row.map_err(|e| e.to_string())?);
    }
    Ok(settings)
}

#[tauri::command]
fn update_app_setting(
    state: tauri::State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let rows = conn
        .execute(
            "UPDATE app_settings SET value = ?1 WHERE key = ?2",
            rusqlite::params![value, key],
        )
        .map_err(|e| e.to_string())?;
    if rows == 0 {
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_dashboard_summary(state: tauri::State<'_, Database>) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    expire_overdue_reservation_sessions(&conn)?;

    let chain_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chains WHERE status = 'active'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let max_length: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(current_length), 0) FROM chains WHERE status = 'active'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let today_completed: i64 = conn
        .query_row("SELECT COUNT(*) FROM focus_sessions WHERE date(created_at) = date('now') AND result = 'completed'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let total_completed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM focus_sessions WHERE result = 'completed'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let active_focus: Option<(i64, String, Option<String>)> = conn.query_row(
        "SELECT f.chain_id, c.name, f.failure_note FROM focus_sessions f JOIN chains c ON c.id = f.chain_id WHERE f.result IS NULL LIMIT 1",
        [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?)),
    ).ok();

    let active_reservation: Option<(i64, String, String, Option<String>, Option<String>, String)> = conn.query_row(
        "SELECT r.chain_id, c.name, r.due_at, r.confirmation_due_at, r.failure_note, datetime('now') FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id WHERE r.result IS NULL LIMIT 1",
        [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, String>(5)?)),
    ).ok();

    let (state, active_chain_id, active_chain_name) = if let Some((fid, fname, note)) = active_focus
    {
        let state_str = if note.as_deref() == Some(PENDING_RULING_NOTE) {
            "focus_pending_ruling"
        } else {
            "focus"
        };
        (state_str.to_string(), Some(fid), Some(fname))
    } else if let Some((rid, rname, due, confirmation_due, note, now)) = active_reservation {
        let phase =
            reservation_phase_from_times(&due, confirmation_due.as_deref(), note.as_deref(), &now);
        let state_str = if phase == "pending_ruling" {
            "reservation_pending_ruling"
        } else if phase == "confirming" {
            "reservation_due"
        } else {
            "reservation_countdown"
        };
        (state_str.to_string(), Some(rid), Some(rname))
    } else {
        ("none".to_string(), None, None)
    };

    Ok(serde_json::json!({
        "chain_count": chain_count,
        "max_current_chain_length": max_length,
        "today_completed_focus_count": today_completed,
        "total_completed_focus_count": total_completed,
        "active_protocol_state": state,
        "active_chain_id": active_chain_id,
        "active_chain_name": active_chain_name,
    }))
}

#[tauri::command]
fn get_recent_protocol_events(
    state: tauri::State<'_, Database>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT 'focus' AS event_type, f.id, f.chain_id, c.name AS chain_name,
                f.started_at AS event_time,
                f.ended_at,
                f.result,
                f.duration_minutes
         FROM focus_sessions f JOIN chains c ON c.id = f.chain_id
         WHERE f.result IS NOT NULL
         UNION ALL
         SELECT 'reservation' AS event_type, r.id, r.chain_id, c.name AS chain_name,
                r.created_at AS event_time,
                r.fulfilled_at AS ended_at,
                r.result,
                NULL AS duration_minutes
         FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id
         WHERE r.result IS NOT NULL
         ORDER BY event_time DESC LIMIT 8",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "event_type": row.get::<_, String>(0)?,
                "id": row.get::<_, i64>(1)?,
                "chain_id": row.get::<_, i64>(2)?,
                "chain_name": row.get::<_, String>(3)?,
                "event_time": row.get::<_, String>(4)?,
                "ended_at": row.get::<_, Option<String>>(5)?,
                "result": row.get::<_, String>(6)?,
                "duration_minutes": row.get::<_, Option<i64>>(7)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| e.to_string())?);
    }
    Ok(events)
}
#[tauri::command]
fn create_rsip_formula(
    state: tauri::State<'_, Database>,
    title: String,
    description: String,
    parent_id: Option<i64>,
) -> Result<serde_json::Value, String> {
    if title.trim().is_empty() {
        return Err("定式标题不能为空".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    if let Some(pid) = parent_id {
        let parent_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM rsip_formulas WHERE id = ?1",
                [pid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !parent_exists {
            return Err("父定式不存在".into());
        }
    }

    let next_position: i64 = if let Some(pid) = parent_id {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM rsip_formulas WHERE parent_id = ?1",
            [pid],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM rsip_formulas WHERE parent_id IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    };

    conn.execute(
        "INSERT INTO rsip_formulas (parent_id, title, description, position) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![parent_id, title.trim(), description.trim(), next_position],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO formula_events (formula_id, event_type, note) VALUES (?1, 'created', ?2)",
        rusqlite::params![id, "定式已加入 RSIP 树"],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        &format!(
            "SELECT {} FROM rsip_formulas WHERE id = ?1",
            RSIP_FORMULA_FIELDS
        ),
        [id],
        rsip_formula_json,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_rsip_formulas(state: tauri::State<'_, Database>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {}
             FROM rsip_formulas
             ORDER BY COALESCE(parent_id, 0), position, created_at",
            RSIP_FORMULA_FIELDS
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], rsip_formula_json)
        .map_err(|e| e.to_string())?;

    let mut formulas = Vec::new();
    for row in rows {
        formulas.push(row.map_err(|e| e.to_string())?);
    }
    Ok(formulas)
}

#[tauri::command]
fn create_rsip_goal(
    state: tauri::State<'_, Database>,
    title: String,
    description: String,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let id = insert_rsip_goal_record(&conn, &title, &description)?;
    get_rsip_goal_record(&conn, id)
}

#[tauri::command]
fn get_rsip_goals(
    state: tauri::State<'_, Database>,
    include_archived: Option<bool>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let include_archived = include_archived.unwrap_or(false);
    let status_filter = if include_archived {
        ""
    } else {
        "WHERE g.status = 'active'"
    };
    let mut stmt = conn
        .prepare(&format!(
            "SELECT g.id, g.title, g.description, g.status, g.created_at, g.updated_at, g.archived_at,
                    COUNT(DISTINCT f.id) AS formula_count,
                    COUNT(DISTINCT p.id) AS failure_path_count
             FROM rsip_goals g
             LEFT JOIN rsip_formulas f ON f.goal_id = g.id
             LEFT JOIN rsip_failure_paths p ON p.goal_id = g.id
             {}
             GROUP BY g.id
             ORDER BY g.created_at DESC, g.id DESC",
            status_filter
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], rsip_goal_json).map_err(|e| e.to_string())?;
    let mut goals = Vec::new();
    for row in rows {
        goals.push(row.map_err(|e| e.to_string())?);
    }
    Ok(goals)
}

#[tauri::command]
fn update_rsip_goal(
    state: tauri::State<'_, Database>,
    id: i64,
    title: String,
    description: String,
    status: Option<String>,
) -> Result<serde_json::Value, String> {
    let (title, description) = clean_rsip_goal_input(&title, &description)?;
    let status = status.unwrap_or_else(|| "active".to_string());
    if !matches!(status.as_str(), "active" | "archived") {
        return Err("goal status must be active or archived".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let rows = conn
        .execute(
            "UPDATE rsip_goals
             SET title = ?2,
                 description = ?3,
                 status = ?4,
                 updated_at = datetime('now'),
                 archived_at = CASE
                   WHEN ?4 = 'archived' AND archived_at IS NULL THEN datetime('now')
                   WHEN ?4 = 'active' THEN NULL
                   ELSE archived_at
                 END
             WHERE id = ?1",
            rusqlite::params![id, title, description, status],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("goal does not exist".into());
    }

    get_rsip_goal_record(&conn, id)
}

#[tauri::command]
fn archive_rsip_goal(
    state: tauri::State<'_, Database>,
    id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let rows = conn
        .execute(
            "UPDATE rsip_goals
             SET status = 'archived',
                 archived_at = COALESCE(archived_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("goal does not exist".into());
    }

    get_rsip_goal_record(&conn, id)
}

#[tauri::command]
fn create_failure_path(
    state: tauri::State<'_, Database>,
    goal_id: i64,
    title: String,
    nodes: Vec<String>,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let id = insert_failure_path_record(&conn, goal_id, &title, nodes)?;
    conn.query_row(
        "SELECT id, goal_id, title, nodes_json, created_at, updated_at
         FROM rsip_failure_paths
         WHERE id = ?1",
        [id],
        rsip_failure_path_json,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_failure_paths(
    state: tauri::State<'_, Database>,
    goal_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    ensure_rsip_goal_exists(&conn, goal_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, goal_id, title, nodes_json, created_at, updated_at
             FROM rsip_failure_paths
             WHERE goal_id = ?1
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([goal_id], rsip_failure_path_json)
        .map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    for row in rows {
        paths.push(row.map_err(|e| e.to_string())?);
    }
    Ok(paths)
}

#[tauri::command]
fn create_formula_from_goal(
    state: tauri::State<'_, Database>,
    goal_id: i64,
    failure_path_id: i64,
    intervention_node_id: String,
    title: String,
    description: String,
    parent_id: Option<i64>,
    dependency_note: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    insert_goal_formula_record(
        &conn,
        goal_id,
        failure_path_id,
        intervention_node_id,
        title,
        description,
        parent_id,
        dependency_note,
    )
}

#[tauri::command]
fn get_formulas_by_goal(
    state: tauri::State<'_, Database>,
    goal_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    get_goal_formula_records(&conn, goal_id)
}

#[tauri::command]
fn update_rsip_formula(
    state: tauri::State<'_, Database>,
    id: i64,
    title: String,
    description: String,
) -> Result<serde_json::Value, String> {
    let (title, description) = clean_rsip_formula_edit(&title, &description)?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let rows = conn
        .execute(
            "UPDATE rsip_formulas
             SET title = ?2,
                 description = ?3,
                 updated_at = datetime('now')
             WHERE id = ?1",
            rusqlite::params![id, title, description],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("定式不存在".into());
    }

    conn.query_row(
        &format!(
            "SELECT {} FROM rsip_formulas WHERE id = ?1",
            RSIP_FORMULA_FIELDS
        ),
        [id],
        rsip_formula_json,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn activate_rsip_formula(
    state: tauri::State<'_, Database>,
    id: i64,
) -> Result<serde_json::Value, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM rsip_formulas WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("定式不存在".into());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE rsip_formulas
         SET status = 'active', activated_at = datetime('now'), deactivated_at = NULL, updated_at = datetime('now')
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO formula_events (formula_id, event_type, note) VALUES (?1, 'activated', ?2)",
        rusqlite::params![id, "定式已点亮"],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    conn.query_row(
        &format!(
            "SELECT {} FROM rsip_formulas WHERE id = ?1",
            RSIP_FORMULA_FIELDS
        ),
        [id],
        rsip_formula_json,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn deactivate_rsip_formula(
    state: tauri::State<'_, Database>,
    id: i64,
    note: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM rsip_formulas WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("定式不存在".into());
    }

    let clean_note = clean_rsip_deactivation_note(note);
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let active_descendants: Vec<i64> = {
        let mut stmt = tx
            .prepare(
                "WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM rsip_formulas WHERE parent_id = ?1
                    UNION ALL
                    SELECT f.id FROM rsip_formulas f JOIN descendants d ON f.parent_id = d.id
                )
                SELECT id FROM rsip_formulas
                WHERE id IN (SELECT id FROM descendants) AND status = 'active'
                ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([id], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row.map_err(|e| e.to_string())?);
        }
        ids
    };

    tx.execute(
        "UPDATE rsip_formulas
         SET status = 'inactive', deactivated_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO formula_events (formula_id, event_type, note) VALUES (?1, 'deactivated', ?2)",
        rusqlite::params![id, clean_note],
    )
    .map_err(|e| e.to_string())?;

    for child_id in active_descendants {
        tx.execute(
            "UPDATE rsip_formulas
             SET status = 'inactive', deactivated_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?1",
            [child_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO formula_events (formula_id, event_type, note) VALUES (?1, 'rollback_child_deactivated', ?2)",
            rusqlite::params![child_id, format!("父定式 {} 熄灭，触发递归回滚", id)],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {}
             FROM rsip_formulas
             ORDER BY COALESCE(parent_id, 0), position, created_at",
            RSIP_FORMULA_FIELDS
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], rsip_formula_json)
        .map_err(|e| e.to_string())?;

    let mut formulas = Vec::new();
    for row in rows {
        formulas.push(row.map_err(|e| e.to_string())?);
    }
    Ok(formulas)
}

#[tauri::command]
fn get_formula_events(
    state: tauri::State<'_, Database>,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let safe_limit = limit.unwrap_or(20).clamp(1, 100);
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.formula_id, f.title, e.event_type, e.note, e.created_at
             FROM formula_events e
             JOIN rsip_formulas f ON f.id = e.formula_id
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([safe_limit], formula_event_json)
        .map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| e.to_string())?);
    }
    Ok(events)
}

#[tauri::command]
fn get_rsip_formula_review(
    state: tauri::State<'_, Database>,
    id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let formula = conn
        .query_row(
            &format!(
                "SELECT {} FROM rsip_formulas WHERE id = ?1",
                RSIP_FORMULA_FIELDS
            ),
            [id],
            rsip_formula_json,
        )
        .map_err(|_| "定式不存在".to_string())?;

    let (child_count, active_child_count): (i64, i64) = conn
        .query_row(
            "WITH RECURSIVE descendants(id, status) AS (
                SELECT id, status FROM rsip_formulas WHERE parent_id = ?1
                UNION ALL
                SELECT f.id, f.status FROM rsip_formulas f JOIN descendants d ON f.parent_id = d.id
            )
            SELECT COUNT(*), SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) FROM descendants",
            [id],
            |row| Ok((row.get(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0))),
        )
        .map_err(|e| e.to_string())?;

    let rollback_event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM formula_events WHERE event_type = 'rollback_child_deactivated' AND note LIKE ?1",
            [format!("%父定式 {} 熄灭%", id)],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let latest_deactivation_note: Option<String> = conn
        .query_row(
            "SELECT note FROM formula_events WHERE formula_id = ?1 AND event_type = 'deactivated' ORDER BY created_at DESC, id DESC LIMIT 1",
            [id],
            |row| row.get(0),
        )
        .ok();

    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.formula_id, f.title, e.event_type, e.note, e.created_at
             FROM formula_events e
             JOIN rsip_formulas f ON f.id = e.formula_id
             WHERE e.formula_id = ?1
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT 30",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([id], formula_event_json)
        .map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| e.to_string())?);
    }

    Ok(serde_json::json!({
        "formula": formula,
        "events": events,
        "child_count": child_count,
        "active_child_count": active_child_count,
        "rollback_event_count": rollback_event_count,
        "latest_deactivation_note": latest_deactivation_note,
    }))
}

#[tauri::command]
fn get_rsip_summary(state: tauri::State<'_, Database>) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let total_formulas: i64 = conn
        .query_row("SELECT COUNT(*) FROM rsip_formulas", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let active_formulas: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM rsip_formulas WHERE status = 'active'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let inactive_formulas: i64 = total_formulas - active_formulas;
    let latest_event = conn
        .query_row(
            "SELECT e.id, e.formula_id, f.title, e.event_type, e.note, e.created_at
             FROM formula_events e
             JOIN rsip_formulas f ON f.id = e.formula_id
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT 1",
            [],
            formula_event_json,
        )
        .ok();

    Ok(serde_json::json!({
        "total_formulas": total_formulas,
        "active_formulas": active_formulas,
        "inactive_formulas": inactive_formulas,
        "latest_event": latest_event,
    }))
}

#[tauri::command]
fn get_chain_review_stats(
    state: tauri::State<'_, Database>,
    since: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let since_filter = since
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let mut sql = String::from(
        "SELECT
            c.id,
            c.name,
            c.status,
            c.current_length,
            c.best_length,
            c.auxiliary_current_length,
            c.auxiliary_best_length,
            COALESCE(f.completed, 0) AS completed_count,
            COALESCE(f.failed_reset, 0) AS failed_reset_count,
            COALESCE(f.failed_precedent, 0) AS failed_precedent_count,
            COALESCE(r.fulfilled, 0) AS reservation_fulfilled_count,
            COALESCE(r.failed_reset, 0) AS reservation_failed_reset_count,
            COALESCE(r.failed_precedent, 0) AS reservation_failed_precedent_count
        FROM chains c
        LEFT JOIN (
            SELECT chain_id,
                SUM(CASE WHEN result = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN result = 'failed_reset' THEN 1 ELSE 0 END) AS failed_reset,
                SUM(CASE WHEN result = 'failed_precedent' THEN 1 ELSE 0 END) AS failed_precedent
            FROM focus_sessions
            WHERE 1=1",
    );

    if since_filter.is_some() {
        sql.push_str(" AND created_at >= ?1");
    }
    sql.push_str(" GROUP BY chain_id) f ON f.chain_id = c.id LEFT JOIN (SELECT chain_id, SUM(CASE WHEN result = 'fulfilled' THEN 1 ELSE 0 END) AS fulfilled, SUM(CASE WHEN result = 'failed_reset' THEN 1 ELSE 0 END) AS failed_reset, SUM(CASE WHEN result = 'failed_precedent' THEN 1 ELSE 0 END) AS failed_precedent FROM reservation_sessions WHERE 1=1");

    if since_filter.is_some() {
        sql.push_str(" AND created_at >= ?2");
    }
    sql.push_str(" GROUP BY chain_id) r ON r.chain_id = c.id ORDER BY c.created_at DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows: Vec<serde_json::Value> = if let Some(ref s) = since_filter {
        stmt.query_map(rusqlite::params![s, s], |row| {
            Ok(serde_json::json!({
                "chain_id": row.get::<_, i64>(0)?,
                "chain_name": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "current_length": row.get::<_, i64>(3)?,
                "best_length": row.get::<_, i64>(4)?,
                "auxiliary_current_length": row.get::<_, i64>(5)?,
                "auxiliary_best_length": row.get::<_, i64>(6)?,
                "completed_count": row.get::<_, i64>(7)?,
                "failed_reset_count": row.get::<_, i64>(8)?,
                "failed_precedent_count": row.get::<_, i64>(9)?,
                "reservation_fulfilled_count": row.get::<_, i64>(10)?,
                "reservation_failed_reset_count": row.get::<_, i64>(11)?,
                "reservation_failed_precedent_count": row.get::<_, i64>(12)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "chain_id": row.get::<_, i64>(0)?,
                "chain_name": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "current_length": row.get::<_, i64>(3)?,
                "best_length": row.get::<_, i64>(4)?,
                "auxiliary_current_length": row.get::<_, i64>(5)?,
                "auxiliary_best_length": row.get::<_, i64>(6)?,
                "completed_count": row.get::<_, i64>(7)?,
                "failed_reset_count": row.get::<_, i64>(8)?,
                "failed_precedent_count": row.get::<_, i64>(9)?,
                "reservation_fulfilled_count": row.get::<_, i64>(10)?,
                "reservation_failed_reset_count": row.get::<_, i64>(11)?,
                "reservation_failed_precedent_count": row.get::<_, i64>(12)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

#[tauri::command]
fn get_failure_debug_summary(
    state: tauri::State<'_, Database>,
    since: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let since_filter = since
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    // Aggregate counts by debug_category
    let mut sql = String::from(
        "SELECT COALESCE(debug_category, '未分类') AS category, COUNT(*) AS cnt FROM (SELECT debug_category FROM focus_sessions WHERE debug_category IS NOT NULL AND (result = 'failed_reset' OR result = 'failed_precedent')",
    );

    if since_filter.is_some() {
        sql.push_str(" AND created_at >= ?1");
    }
    sql.push_str(" UNION ALL SELECT debug_category FROM reservation_sessions WHERE debug_category IS NOT NULL AND (result = 'failed_reset' OR result = 'failed_precedent')");
    if since_filter.is_some() {
        sql.push_str(" AND created_at >= ?2");
    }
    sql.push_str(") GROUP BY category ORDER BY cnt DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let categories: Vec<(String, i64)> = if let Some(ref s) = since_filter {
        stmt.query_map(rusqlite::params![s, s], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    // Fetch per-category detail: recent notes, last occurred time, and involved chain names
    let mut results = Vec::new();
    for (category, count) in categories {
        // Recent notes (up to 5)
        let mut notes_sql = String::from(
            "SELECT note FROM (SELECT debug_note AS note, created_at FROM focus_sessions WHERE debug_category = ?1 AND debug_note IS NOT NULL AND debug_note != '' AND (result = 'failed_reset' OR result = 'failed_precedent')",
        );
        if since_filter.is_some() {
            notes_sql.push_str(" AND created_at >= ?3");
        }
        notes_sql.push_str(" UNION ALL SELECT debug_note, created_at FROM reservation_sessions WHERE debug_category = ?2 AND debug_note IS NOT NULL AND debug_note != '' AND (result = 'failed_reset' OR result = 'failed_precedent')");
        if since_filter.is_some() {
            notes_sql.push_str(" AND created_at >= ?4");
        }
        notes_sql.push_str(") ORDER BY created_at DESC LIMIT 5");

        let mut notes_stmt = conn.prepare(&notes_sql).map_err(|e| e.to_string())?;
        let notes: Vec<String> = if let Some(ref s) = since_filter {
            notes_stmt
                .query_map(rusqlite::params![category, category, s, s], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            notes_stmt
                .query_map(rusqlite::params![category, category], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };

        // Last occurred time (most recent created_at across both session types)
        let mut last_sql = String::from(
            "SELECT MAX(created_at) FROM (SELECT created_at FROM focus_sessions WHERE debug_category = ?1 AND (result = 'failed_reset' OR result = 'failed_precedent')",
        );
        if since_filter.is_some() {
            last_sql.push_str(" AND created_at >= ?3");
        }
        last_sql.push_str(" UNION ALL SELECT created_at FROM reservation_sessions WHERE debug_category = ?2 AND (result = 'failed_reset' OR result = 'failed_precedent')");
        if since_filter.is_some() {
            last_sql.push_str(" AND created_at >= ?4");
        }
        last_sql.push_str(")");

        let mut last_stmt = conn.prepare(&last_sql).map_err(|e| e.to_string())?;
        let last_occurred_at: Option<String> = if let Some(ref s) = since_filter {
            last_stmt
                .query_row(rusqlite::params![category, category, s, s], |row| {
                    row.get::<_, Option<String>>(0)
                })
                .ok()
                .flatten()
        } else {
            last_stmt
                .query_row(rusqlite::params![category, category], |row| {
                    row.get::<_, Option<String>>(0)
                })
                .ok()
                .flatten()
        };

        // Distinct chain names involved
        let mut chains_sql = String::from(
            "SELECT DISTINCT c.name FROM focus_sessions f JOIN chains c ON c.id = f.chain_id WHERE f.debug_category = ?1 AND (f.result = 'failed_reset' OR f.result = 'failed_precedent')",
        );
        if since_filter.is_some() {
            chains_sql.push_str(" AND f.created_at >= ?3");
        }
        chains_sql.push_str(" UNION SELECT DISTINCT c.name FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id WHERE r.debug_category = ?2 AND (r.result = 'failed_reset' OR r.result = 'failed_precedent')");
        if since_filter.is_some() {
            chains_sql.push_str(" AND r.created_at >= ?4");
        }

        let mut chains_stmt = conn.prepare(&chains_sql).map_err(|e| e.to_string())?;
        let chain_names: Vec<String> = if let Some(ref s) = since_filter {
            chains_stmt
                .query_map(rusqlite::params![category, category, s, s], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            chains_stmt
                .query_map(rusqlite::params![category, category], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
        };

        results.push(serde_json::json!({
            "category": category,
            "count": count,
            "recent_notes": notes,
            "last_occurred_at": last_occurred_at,
            "chain_names": chain_names,
        }));
    }

    Ok(results)
}

#[tauri::command]
fn get_precedent_review_list(
    state: tauri::State<'_, Database>,
    since: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let since_filter = since
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let mut sql = String::from(
        "SELECT p.id, p.chain_id, c.name AS chain_name, p.scope, p.title, p.description, p.created_from_session_id, p.created_from_session_type, p.status, p.created_at, p.updated_at, p.retired_at FROM precedents p JOIN chains c ON c.id = p.chain_id WHERE 1=1",
    );

    if since_filter.is_some() {
        sql.push_str(" AND p.created_at >= ?1");
    }
    sql.push_str(" ORDER BY p.created_at DESC");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows: Vec<serde_json::Value> = if let Some(ref s) = since_filter {
        stmt.query_map([s], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "chain_name": row.get::<_, String>(2)?,
                "scope": row.get::<_, String>(3)?,
                "title": row.get::<_, String>(4)?,
                "description": row.get::<_, String>(5)?,
                "created_from_session_id": row.get::<_, Option<i64>>(6)?,
                "created_from_session_type": row.get::<_, Option<String>>(7)?,
                "status": row.get::<_, String>(8)?,
                "created_at": row.get::<_, String>(9)?,
                "updated_at": row.get::<_, Option<String>>(10)?,
                "retired_at": row.get::<_, Option<String>>(11)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "chain_name": row.get::<_, String>(2)?,
                "scope": row.get::<_, String>(3)?,
                "title": row.get::<_, String>(4)?,
                "description": row.get::<_, String>(5)?,
                "created_from_session_id": row.get::<_, Option<i64>>(6)?,
                "created_from_session_type": row.get::<_, Option<String>>(7)?,
                "status": row.get::<_, String>(8)?,
                "created_at": row.get::<_, String>(9)?,
                "updated_at": row.get::<_, Option<String>>(10)?,
                "retired_at": row.get::<_, Option<String>>(11)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

#[tauri::command]
fn get_protocol_timeline(
    state: tauri::State<'_, Database>,
    type_filter: Option<String>,
    result_filter: Option<String>,
    chain_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let safe_limit = limit.unwrap_or(100).clamp(1, 300);

    let mut sql = String::from(
        "SELECT * FROM (
            SELECT 'focus' AS event_type, f.id, f.chain_id, c.name AS chain_name,
                   NULL AS formula_id, NULL AS formula_title,
                   f.started_at AS event_time, f.ended_at, f.result, f.duration_minutes,
                   f.failure_note AS note,
                   p.id AS precedent_id, p.title AS precedent_title
            FROM focus_sessions f JOIN chains c ON c.id = f.chain_id
            LEFT JOIN precedents p ON p.created_from_session_type = 'focus' AND p.created_from_session_id = f.id
            WHERE f.result IS NOT NULL
            UNION ALL
            SELECT 'reservation' AS event_type, r.id, r.chain_id, c.name AS chain_name,
                   NULL AS formula_id, NULL AS formula_title,
                   r.created_at AS event_time, r.fulfilled_at AS ended_at, r.result, NULL AS duration_minutes,
                   r.failure_note AS note,
                   p.id AS precedent_id, p.title AS precedent_title
            FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id
            LEFT JOIN precedents p ON p.created_from_session_type = 'reservation' AND p.created_from_session_id = r.id
            WHERE r.result IS NOT NULL
            UNION ALL
            SELECT 'rsip' AS event_type, e.id, NULL AS chain_id, NULL AS chain_name,
                   e.formula_id, f.title AS formula_title,
                   e.created_at AS event_time, NULL AS ended_at, e.event_type AS result, NULL AS duration_minutes,
                   e.note AS note,
                   NULL AS precedent_id, NULL AS precedent_title
            FROM formula_events e JOIN rsip_formulas f ON f.id = e.formula_id
        )",
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut filters = Vec::new();

    if let Some(ref tf) = type_filter {
        if matches!(tf.as_str(), "focus" | "reservation" | "rsip") {
            filters.push(format!("event_type = '{}'", tf));
        }
    }
    if let Some(ref rf) = result_filter {
        if rf == "success" {
            filters
                .push("result IN ('completed', 'fulfilled', 'activated', 'created')".to_string());
        } else if rf == "failed" {
            filters.push(
                "result IN ('failed_reset', 'deactivated', 'rollback_child_deactivated')"
                    .to_string(),
            );
        } else if rf == "precedent" {
            filters.push("result IN ('failed_precedent')".to_string());
        }
    }
    if let Some(cid) = chain_id {
        params.push(Box::new(cid));
        filters.push(format!("chain_id = ?{}", params.len()));
    }

    if !filters.is_empty() {
        sql = format!("{} WHERE {}", sql, filters.join(" AND "));
    }
    params.push(Box::new(safe_limit));
    sql = format!(
        "{} ORDER BY event_time DESC, id DESC LIMIT ?{}",
        sql,
        params.len()
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(serde_json::json!({
                "event_type": row.get::<_, String>(0)?,
                "id": row.get::<_, i64>(1)?,
                "chain_id": row.get::<_, Option<i64>>(2)?,
                "chain_name": row.get::<_, Option<String>>(3)?,
                "formula_id": row.get::<_, Option<i64>>(4)?,
                "formula_title": row.get::<_, Option<String>>(5)?,
                "event_time": row.get::<_, String>(6)?,
                "ended_at": row.get::<_, Option<String>>(7)?,
                "result": row.get::<_, String>(8)?,
                "duration_minutes": row.get::<_, Option<i64>>(9)?,
                "note": row.get::<_, Option<String>>(10)?,
                "precedent_id": row.get::<_, Option<i64>>(11)?,
                "precedent_title": row.get::<_, Option<String>>(12)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| e.to_string())?);
    }
    Ok(events)
}

// ===== Data Management Commands =====

const REQUIRED_TABLES: &[&str] = &[
    "chains",
    "focus_sessions",
    "reservation_sessions",
    "precedents",
    "app_settings",
];

const RSIP_TABLES: &[&str] = &[
    "rsip_formulas",
    "formula_events",
    "rsip_goals",
    "rsip_failure_paths",
];

fn database_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn validate_backup_header(file: &File) -> Result<(), String> {
    let mut reader = file
        .try_clone()
        .map_err(|e| format!("无法绑定备份文件句柄: {e}"))?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|e| format!("无法定位备份文件头: {e}"))?;
    let mut header = [0_u8; 20];
    reader
        .read_exact(&mut header)
        .map_err(|e| format!("备份文件头不完整: {e}"))?;
    if &header[..16] != b"SQLite format 3\0" {
        return Err("选择的文件不是有效的 SQLite 数据库".into());
    }

    if header[18] == 2 || header[19] == 2 {
        return Err("选择的是 WAL 模式数据库，不是自包含的 Protocol 备份".into());
    }
    Ok(())
}

fn validate_backup_sidecar_state(path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = database_sidecar_path(path, suffix);
        match fs::symlink_metadata(&sidecar) {
            Ok(_) => {
                return Err(format!(
                    "选择的数据库存在 {suffix} sidecar，不是自包含的 Protocol 备份"
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "无法确认备份 sidecar 状态 {}: {error}",
                    sidecar.display()
                ));
            }
        }
    }
    Ok(())
}

struct BoundBackupSource {
    path: PathBuf,
    identity: FileIdentity,
    identity_handle: File,
    connection: Connection,
}

#[cfg(windows)]
fn verify_sqlite_connection_identity(
    connection: &Connection,
    expected: FileIdentity,
) -> Result<(), String> {
    let mut handle: *mut std::ffi::c_void = std::ptr::null_mut();
    // SAFETY: the SQLite connection is live and the Win32 VFS writes one
    // native HANDLE value to `handle`.
    let result = unsafe {
        ffi::sqlite3_file_control(
            connection.handle(),
            c"main".as_ptr(),
            ffi::SQLITE_FCNTL_WIN32_GET_HANDLE,
            (&mut handle as *mut *mut std::ffi::c_void).cast(),
        )
    };
    if result != ffi::SQLITE_OK || handle.is_null() {
        return Err(format!(
            "无法读取 SQLite 已打开源文件身份: error code {result}"
        ));
    }
    let actual =
        windows_handle_identity(handle).map_err(|e| format!("无法核对 SQLite 源文件句柄: {e}"))?;
    if actual != expected {
        return Err("SQLite 已打开的文件与绑定备份源身份不一致".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn verify_sqlite_connection_identity(
    connection: &Connection,
    _expected: FileIdentity,
) -> Result<(), String> {
    let mut moved = 0_i32;
    // SAFETY: the connection is alive for this call, "main" is a
    // NUL-terminated database name, and SQLite writes one i32 to `moved`.
    let result = unsafe {
        ffi::sqlite3_file_control(
            connection.handle(),
            c"main".as_ptr(),
            ffi::SQLITE_FCNTL_HAS_MOVED,
            (&mut moved as *mut i32).cast(),
        )
    };
    if result != ffi::SQLITE_OK {
        return Err(format!(
            "无法核对 SQLite 已打开源文件身份: error code {result}"
        ));
    }
    if moved != 0 {
        return Err("SQLite 已打开的备份源在检查期间已被替换或移动".into());
    }
    Ok(())
}

impl BoundBackupSource {
    fn connection(&self) -> &Connection {
        &self.connection
    }

    fn verify_unchanged_and_self_contained(&self) -> Result<(), String> {
        verify_sqlite_connection_identity(&self.connection, self.identity)?;

        let current = File::open(&self.path)
            .map_err(|e| format!("备份源在检查期间不可访问或已被替换: {e}"))?;
        let current_identity =
            file_identity(&current).map_err(|e| format!("无法读取当前备份源身份: {e}"))?;
        if current_identity != self.identity {
            return Err("备份源在检查期间已被替换，已取消恢复预览".into());
        }
        let bound_identity = file_identity(&self.identity_handle)
            .map_err(|e| format!("无法复核已绑定备份源身份: {e}"))?;
        if bound_identity != self.identity {
            return Err("已绑定备份源身份在检查期间发生变化".into());
        }
        validate_backup_header(&self.identity_handle)?;
        validate_backup_sidecar_state(&self.path)
    }

    fn into_connection(self) -> Connection {
        self.connection
    }
}

fn bind_backup_source_impl<F, P>(
    path: &Path,
    after_identity_bound: F,
    after_snapshot_pinned: P,
) -> Result<BoundBackupSource, String>
where
    F: FnOnce(&Path),
    P: FnOnce(&Path),
{
    let path = path
        .canonicalize()
        .map_err(|e| format!("无法解析备份路径 {}: {e}", path.display()))?;
    let identity_handle = File::open(&path).map_err(|e| format!("无法只读绑定备份文件: {e}"))?;
    let metadata = identity_handle
        .metadata()
        .map_err(|e| format!("无法读取备份文件信息: {e}"))?;
    if !metadata.is_file() {
        return Err("备份路径不是普通文件".into());
    }
    let identity =
        file_identity(&identity_handle).map_err(|e| format!("无法读取备份文件身份: {e}"))?;
    validate_backup_header(&identity_handle)?;
    validate_backup_sidecar_state(&path)?;
    after_identity_bound(&path);

    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_NO_MUTEX
        | OpenFlags::SQLITE_OPEN_NOFOLLOW;
    let connection = Connection::open_with_flags(&path, flags)
        .map_err(|e| format!("无法只读打开 SQLite 备份: {e}"))?;
    connection
        .execute_batch("BEGIN DEFERRED TRANSACTION;")
        .map_err(|e| format!("无法固定备份读取事务: {e}"))?;
    connection
        .pragma_query_value(None, "schema_version", |row| row.get::<_, i64>(0))
        .map_err(|e| format!("无法固定备份读取快照: {e}"))?;
    after_snapshot_pinned(&path);

    Ok(BoundBackupSource {
        path,
        identity,
        identity_handle,
        connection,
    })
}

fn bind_backup_source(path: &Path) -> Result<BoundBackupSource, String> {
    bind_backup_source_impl(path, |_| {}, |_| {})
}

fn open_backup_read_only(path: &Path) -> Result<Connection, String> {
    let source = bind_backup_source(path)?;
    source.verify_unchanged_and_self_contained()?;
    Ok(source.into_connection())
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

fn copy_database_snapshot(source: &Connection, destination: &mut Connection) -> Result<(), String> {
    let step_result = {
        let backup = Backup::new(source, destination)
            .map_err(|e| format!("无法初始化 SQLite 快照复制，数据库可能被锁定或占用: {e}"))?;
        backup
            .step(-1)
            .map_err(|e| format!("SQLite 快照复制失败，数据库可能被锁定或占用: {e}"))?
    };

    match step_result {
        StepResult::Done => Ok(()),
        StepResult::Busy => Err("数据库正在被其他连接占用或锁定".into()),
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
    let backup =
        Backup::new(source, destination).map_err(|e| format!("无法初始化测试快照复制: {e}"))?;
    let result = backup
        .step(pages)
        .map_err(|e| format!("测试快照复制失败: {e}"))?;
    drop(backup);
    Ok(result)
}

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

fn database_file_paths(path: &Path) -> [PathBuf; 4] {
    [
        path.to_path_buf(),
        database_sidecar_path(path, "-wal"),
        database_sidecar_path(path, "-shm"),
        database_sidecar_path(path, "-journal"),
    ]
}

fn is_exact_task_owned_database_name(name: &str, prefix: &str) -> bool {
    let Some(identity) = name
        .strip_prefix(prefix)
        .and_then(|value| value.strip_prefix('-'))
        .and_then(|value| value.strip_suffix(".sqlite"))
    else {
        return false;
    };
    let mut parts = identity.split('-');
    matches!(
        (
            parts.next().and_then(|value| value.parse::<u128>().ok()),
            parts.next().and_then(|value| value.parse::<u32>().ok()),
            parts.next().and_then(|value| value.parse::<u64>().ok()),
            parts.next(),
        ),
        (Some(_), Some(_), Some(_), None)
    )
}

fn task_owned_database_base_name(name: &str) -> Option<&str> {
    let base = ["-wal", "-shm", "-journal"]
        .iter()
        .find_map(|suffix| name.strip_suffix(suffix))
        .unwrap_or(name);
    [RESTORE_STAGING_PREFIX, RESTORE_PREVIEW_PREFIX]
        .iter()
        .any(|prefix| is_exact_task_owned_database_name(base, prefix))
        .then_some(base)
}

fn database_file_identities(path: &Path) -> Result<Vec<PathBuf>, String> {
    database_file_paths(path)
        .iter()
        .map(|candidate| match candidate.canonicalize() {
            Ok(identity) => Ok(identity),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let parent = candidate
                    .parent()
                    .ok_or_else(|| format!("无法定位数据库文件目录: {}", candidate.display()))?;
                let parent = parent
                    .canonicalize()
                    .map_err(|e| format!("无法解析数据库文件目录 {}: {e}", parent.display()))?;
                let name = candidate
                    .file_name()
                    .ok_or_else(|| format!("无法读取数据库文件名: {}", candidate.display()))?;
                Ok(parent.join(name))
            }
            Err(error) => Err(format!(
                "无法解析数据库文件路径 {}: {error}",
                candidate.display()
            )),
        })
        .collect()
}

fn remove_database_files(path: &Path) -> Result<(), String> {
    let candidates = database_file_paths(path);
    let mut errors = Vec::new();
    for candidate in &candidates {
        match fs::remove_file(candidate) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => errors.push(format!("{}: {error}", candidate.display())),
        }
    }
    for candidate in &candidates {
        match fs::symlink_metadata(candidate) {
            Ok(_) => errors.push(format!("清理后文件仍存在: {}", candidate.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => errors.push(format!("无法确认清理结果 {}: {error}", candidate.display())),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn cleanup_database_on_error<T>(
    result: Result<T, String>,
    path: &Path,
    label: &str,
) -> Result<T, String> {
    result.or_else(|error| match remove_database_files(path) {
        Ok(()) => Err(error),
        Err(cleanup_error) => Err(format!("{error}; {label}清理也失败: {cleanup_error}")),
    })
}

fn cleanup_stale_staging_files(
    staging_dir: &Path,
    now: SystemTime,
    minimum_age: Duration,
    protected_database: Option<&Path>,
) -> Result<(), String> {
    match fs::symlink_metadata(staging_dir) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return Err("restore 工作路径不是目录".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("无法读取 restore 工作目录: {error}")),
    }
    let protected_identities = protected_database
        .map(database_file_identities)
        .transpose()?
        .unwrap_or_default();
    let mut task_owned_bases = HashSet::new();
    for entry in fs::read_dir(staging_dir).map_err(|e| format!("无法扫描 staging 目录: {e}"))?
    {
        let entry = entry.map_err(|e| format!("无法读取 staging 条目: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(base_name) = task_owned_database_base_name(&name) else {
            continue;
        };
        task_owned_bases.insert(staging_dir.join(base_name));
    }

    for base_path in task_owned_bases {
        if registered_restore_preview_identity(&base_path)?.is_some() {
            continue;
        }
        let candidate_identities = database_file_identities(&base_path)?;
        if candidate_identities
            .iter()
            .any(|candidate| protected_identities.contains(candidate))
        {
            continue;
        }

        let mut newest_modified: Option<SystemTime> = None;
        for candidate in database_file_paths(&base_path) {
            match fs::symlink_metadata(&candidate) {
                Ok(metadata) => {
                    let modified = metadata.modified().map_err(|e| {
                        format!("无法读取 restore 文件修改时间 {}: {e}", candidate.display())
                    })?;
                    newest_modified =
                        Some(newest_modified.map_or(modified, |current| current.max(modified)));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "无法读取 restore 文件状态 {}: {error}",
                        candidate.display()
                    ));
                }
            }
        }
        let Some(newest_modified) = newest_modified else {
            continue;
        };
        if now.duration_since(newest_modified).unwrap_or_default() >= minimum_age {
            remove_database_files(&base_path)?;
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

fn prepare_restore_staging_from_source(
    source: &Connection,
    app_dir: &Path,
) -> Result<StagedDatabase, String> {
    let staging_dir = canonical_restore_directory_from_app_dir(app_dir)?;
    let staging_path = unique_database_path(&staging_dir, RESTORE_STAGING_PREFIX)?;
    let result = (|| {
        let mut staging = Connection::open(&staging_path)
            .map_err(|e| format!("无法打开恢复 staging 数据库: {e}"))?;
        copy_database_snapshot(source, &mut staging)?;
        validate_backup_source(&staging)?;
        staging
            .execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("无法启用 staging 外键: {e}"))?;
        initialize_schema_on(&staging).map_err(|e| format!("无法升级恢复 staging 数据库: {e}"))?;
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

    cleanup_database_on_error(result, &staging_path, "staging").map(|connection| StagedDatabase {
        path: staging_path,
        connection: Some(connection),
    })
}

#[cfg(test)]
fn prepare_restore_staging(backup_path: &Path, app_dir: &Path) -> Result<StagedDatabase, String> {
    let source = bind_backup_source(backup_path)?;
    validate_backup_source(source.connection())?;
    let staging_dir = canonical_restore_directory_from_app_dir(app_dir)?;
    cleanup_stale_staging_files(
        &staging_dir,
        SystemTime::now(),
        RESTORE_STALE_AGE,
        Some(&source.path),
    )?;
    source.verify_unchanged_and_self_contained()?;
    prepare_restore_staging_from_source(source.connection(), app_dir)
}

fn canonical_restore_directory_from_app_dir(app_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(app_dir).map_err(|e| format!("无法创建应用数据库目录: {e}"))?;
    let app_dir = app_dir
        .canonicalize()
        .map_err(|e| format!("无法解析应用数据库目录: {e}"))?;
    let restore_dir = app_dir.join(RESTORE_DIRECTORY_NAME);
    fs::create_dir_all(&restore_dir).map_err(|e| format!("无法创建 restore 工作目录: {e}"))?;
    restore_dir
        .canonicalize()
        .map_err(|e| format!("无法解析 restore 工作目录: {e}"))
}

fn canonical_restore_directory(database: &Database) -> Result<PathBuf, String> {
    let app_dir = database
        .db_path
        .parent()
        .ok_or_else(|| "无法定位数据库目录".to_string())?;
    canonical_restore_directory_from_app_dir(app_dir)
}

fn restore_preview_file_identity(path: &Path) -> Result<Option<FileIdentity>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err("恢复预览不能是符号链接".into()),
        Ok(metadata) if !metadata.is_file() => Err("恢复预览不是普通文件".into()),
        Ok(_) => {
            let file =
                File::open(path).map_err(|e| format!("无法打开当前恢复预览以核对身份: {e}"))?;
            file_identity(&file)
                .map(Some)
                .map_err(|e| format!("无法读取当前恢复预览身份: {e}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取恢复预览状态: {error}")),
    }
}

fn remove_preview_files_with_identity(path: &Path, expected: FileIdentity) -> Result<(), String> {
    if restore_preview_file_identity(path)?.is_some_and(|current| current != expected) {
        return Err("恢复预览文件身份已被替换，未删除当前路径".into());
    }
    remove_database_files(path)
}

fn task_owned_preview_path(
    database: &Database,
    candidate: &Path,
    require_main_file: bool,
) -> Result<PathBuf, String> {
    let restore_dir = canonical_restore_directory(database)?;
    let file_name = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "恢复预览缺少有效文件名".to_string())?;
    if !is_exact_task_owned_database_name(file_name, RESTORE_PREVIEW_PREFIX) {
        return Err("恢复预览身份无效".into());
    }
    let parent = candidate
        .parent()
        .ok_or_else(|| "恢复预览缺少父目录".to_string())?
        .canonicalize()
        .map_err(|e| format!("无法解析恢复预览目录: {e}"))?;
    if parent != restore_dir {
        return Err("恢复预览不属于应用的 .restore 工作目录".into());
    }

    let normalized = restore_dir.join(file_name);
    let mut registry = restore_preview_registry()?;
    let registered_identity = registry
        .get(&normalized)
        .map(|preview| preview.identity)
        .ok_or_else(|| "恢复预览不属于当前检查任务".to_string())?;
    let current_identity = match restore_preview_file_identity(&normalized) {
        Ok(identity) => identity,
        Err(error) => {
            registry.remove(&normalized);
            return Err(error);
        }
    };
    if current_identity.is_none() && require_main_file {
        registry.remove(&normalized);
        return Err("恢复预览不存在或已被使用".into());
    }
    if current_identity.is_some_and(|identity| identity != registered_identity) {
        registry.remove(&normalized);
        return Err("恢复预览文件身份已被替换".into());
    }
    Ok(normalized)
}

fn discard_restore_preview_inner(database: &Database, preview_path: &Path) -> Result<(), String> {
    let preview_path = task_owned_preview_path(database, preview_path, false)?;
    remove_registered_restore_preview(&preview_path)
}

fn discard_pending_restore_previews_inner(database: &Database) -> Result<(), String> {
    let restore_dir = canonical_restore_directory(database)?;
    let pending = {
        let mut registry = restore_preview_registry()?;
        let mut pending = Vec::new();
        registry.retain(|path, preview| {
            if path.parent() != Some(restore_dir.as_path()) {
                return true;
            }
            drop(preview.source.take());
            pending.push((path.clone(), preview.identity));
            false
        });
        pending
    };

    let mut errors = Vec::new();
    for (path, identity) in pending {
        if let Err(error) = remove_preview_files_with_identity(&path, identity) {
            errors.push(format!("{}: {error}", path.display()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("部分待处理恢复预览无法清理: {}", errors.join("; ")))
    }
}

fn backup_file_info(
    source_path: &Path,
    preview_path: &Path,
    conn: &Connection,
) -> Result<serde_json::Value, String> {
    let file_size_bytes = fs::metadata(preview_path)
        .map_err(|e| format!("无法读取恢复预览文件信息: {e}"))?
        .len();
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("无法读取数据库版本: {e}"))?;
    let total_user_tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("无法统计数据库数据表: {e}"))?;

    let mut table_info = serde_json::Map::new();
    for table in REQUIRED_TABLES.iter().chain(RSIP_TABLES.iter()) {
        if table_exists(conn, table)? {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| {
                    row.get(0)
                })
                .map_err(|e| format!("无法统计数据表 {table}: {e}"))?;
            table_info.insert(table.to_string(), serde_json::json!(count));
        } else {
            table_info.insert(
                table.to_string(),
                serde_json::Value::String("(表不存在)".into()),
            );
        }
    }

    Ok(serde_json::json!({
        "source_path": source_path.to_string_lossy(),
        "restore_preview_path": preview_path.to_string_lossy(),
        "file_size_bytes": file_size_bytes,
        "version": version,
        "tables": table_info,
        "total_user_tables": total_user_tables,
    }))
}

fn inspect_backup_file_inner_impl<F, P>(
    database: &Database,
    backup_path: &Path,
    after_identity_bound: F,
    after_snapshot_pinned: P,
) -> Result<serde_json::Value, String>
where
    F: FnOnce(&Path),
    P: FnOnce(&Path),
{
    let restore_dir = canonical_restore_directory(database)?;
    let source = bind_backup_source_impl(backup_path, after_identity_bound, after_snapshot_pinned)?;
    cleanup_stale_staging_files(
        &restore_dir,
        SystemTime::now(),
        RESTORE_STALE_AGE,
        Some(&source.path),
    )?;

    validate_backup_source(source.connection())?;
    let preview_path = unique_database_path(&restore_dir, RESTORE_PREVIEW_PREFIX)?;
    let preview_result = (|| {
        let mut preview =
            Connection::open(&preview_path).map_err(|e| format!("无法创建不可变恢复预览: {e}"))?;
        source.verify_unchanged_and_self_contained()?;
        copy_database_snapshot(source.connection(), &mut preview)?;
        preview
            .execute_batch("PRAGMA journal_mode=DELETE;")
            .map_err(|e| format!("无法将恢复预览转换为自包含模式: {e}"))?;
        drop(preview);

        let preview = open_backup_read_only(&preview_path)?;
        validate_backup_source(&preview)?;
        let info = backup_file_info(backup_path, &preview_path, &preview)?;
        Ok((info, preview))
    })();

    let (info, preview) = cleanup_database_on_error(preview_result, &preview_path, "恢复预览")?;
    cleanup_database_on_error(
        register_restore_preview(&preview_path, preview).map(|_| info),
        &preview_path,
        "恢复预览",
    )
}

fn inspect_backup_file_inner(
    database: &Database,
    backup_path: &Path,
) -> Result<serde_json::Value, String> {
    inspect_backup_file_inner_impl(database, backup_path, |_| {}, |_| {})
}

#[derive(Debug)]
struct RestoreSuccess {
    safety_path: PathBuf,
    cleanup_warning: Option<String>,
}

fn create_safety_snapshot(live: &Connection, database_path: &Path) -> Result<PathBuf, String> {
    let app_dir = database_path
        .parent()
        .ok_or_else(|| "无法定位数据库目录".to_string())?;
    let safety_dir = app_dir.join(".backup");
    let safety_path = unique_database_path(&safety_dir, "pre-restore")?;

    let result = (|| {
        let mut safety =
            Connection::open(&safety_path).map_err(|e| format!("无法创建恢复前安全快照: {e}"))?;
        copy_database_snapshot(live, &mut safety)?;
        safety
            .execute_batch("PRAGMA journal_mode=DELETE;")
            .map_err(|e| format!("无法将安全快照转换为自包含模式: {e}"))?;
        drop(safety);
        let safety = open_backup_read_only(&safety_path)?;
        validate_current_schema(&safety)?;
        Ok(())
    })();

    cleanup_database_on_error(result, &safety_path, "无效安全快照").map(|_| safety_path)
}

fn database_page_size(conn: &Connection) -> Result<i64, String> {
    conn.pragma_query_value(None, "page_size", |row| row.get(0))
        .map_err(|e| format!("无法读取数据库 page size: {e}"))
}

fn restore_database_inner(
    database: &Database,
    preview_path: &Path,
) -> Result<RestoreSuccess, String> {
    restore_database_inner_impl(
        database,
        preview_path,
        validate_current_schema,
        copy_database_snapshot,
        copy_database_snapshot,
    )
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

fn restore_database_inner_impl<F, L, R>(
    database: &Database,
    preview_path: &Path,
    post_restore_validator: F,
    live_copier: L,
    rollback_copier: R,
) -> Result<RestoreSuccess, String>
where
    F: FnOnce(&Connection) -> Result<(), String>,
    L: FnOnce(&Connection, &mut Connection) -> Result<(), String>,
    R: FnOnce(&Connection, &mut Connection) -> Result<(), String>,
{
    let preview_path = task_owned_preview_path(database, preview_path, true)?;
    let restore_dir = canonical_restore_directory(database)?;
    let stale_cleanup = cleanup_stale_staging_files(
        &restore_dir,
        SystemTime::now(),
        RESTORE_STALE_AGE,
        Some(&preview_path),
    );
    let mut registered = restore_preview_registry()?
        .remove(&preview_path)
        .ok_or_else(|| "恢复预览不属于当前检查任务".to_string())?;
    let identity = registered.identity;
    let source = match registered.source.take() {
        Some(source) => source,
        None => {
            return match remove_preview_files_with_identity(&preview_path, identity) {
                Ok(()) => Err("恢复预览已不可用于恢复，并已完成清理".into()),
                Err(cleanup_error) => Err(format!(
                    "恢复预览已不可用于恢复，清理也失败: {cleanup_error}"
                )),
            };
        }
    };
    let restore_result = stale_cleanup.and_then(|_| {
        restore_database_from_preview(
            database,
            &source,
            post_restore_validator,
            live_copier,
            rollback_copier,
        )
    });
    drop(source);
    let preview_cleanup = remove_preview_files_with_identity(&preview_path, identity);
    match (restore_result, preview_cleanup) {
        (Ok(success), Ok(())) => Ok(success),
        (Ok(mut success), Err(cleanup_error)) => {
            let warning = format!("恢复预览清理失败: {cleanup_error}");
            success.cleanup_warning = Some(match success.cleanup_warning {
                Some(existing) => format!("{existing}; {warning}"),
                None => warning,
            });
            Ok(success)
        }
        (Err(error), Ok(())) => Err(error),
        (Err(error), Err(cleanup_error)) => {
            Err(format!("{error}\n恢复预览清理也失败: {cleanup_error}"))
        }
    }
}

fn restore_database_from_preview<F, L, R>(
    database: &Database,
    preview: &Connection,
    post_restore_validator: F,
    live_copier: L,
    rollback_copier: R,
) -> Result<RestoreSuccess, String>
where
    F: FnOnce(&Connection) -> Result<(), String>,
    L: FnOnce(&Connection, &mut Connection) -> Result<(), String>,
    R: FnOnce(&Connection, &mut Connection) -> Result<(), String>,
{
    let app_dir = database
        .db_path
        .parent()
        .ok_or_else(|| "无法定位数据库目录".to_string())?;
    validate_backup_source(preview)?;
    let mut staging = prepare_restore_staging_from_source(preview, app_dir)?;
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
        if let Err(copy_error) = live_copier(staging.connection(), &mut live) {
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
            cleanup_warning: None,
        })
    })();

    let cleanup_result = staging.cleanup();
    match (restore_result, cleanup_result) {
        (Ok(success), Ok(())) => Ok(success),
        (Ok(mut success), Err(cleanup_error)) => {
            success.cleanup_warning = Some(format!("staging 清理失败: {cleanup_error}"));
            Ok(success)
        }
        (Err(error), Ok(())) => Err(error),
        (Err(error), Err(cleanup_error)) => {
            Err(format!("{error}\nstaging 清理也失败: {cleanup_error}"))
        }
    }
}

#[tauri::command]
fn inspect_backup_file(
    state: tauri::State<'_, Database>,
    backup_path: String,
) -> Result<serde_json::Value, String> {
    inspect_backup_file_inner(&state, Path::new(&backup_path))
}

#[tauri::command]
fn discard_restore_preview(
    state: tauri::State<'_, Database>,
    preview_path: String,
) -> Result<(), String> {
    discard_restore_preview_inner(&state, Path::new(&preview_path))
}

#[tauri::command]
fn discard_pending_restore_previews(state: tauri::State<'_, Database>) -> Result<(), String> {
    discard_pending_restore_previews_inner(&state)
}

#[tauri::command]
fn backup_database(
    state: tauri::State<'_, Database>,
    dest_path: String,
) -> Result<String, String> {
    // 确保目标目录存在
    let dest = Path::new(&dest_path);
    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建目标目录: {}", e))?;
        }
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // 先执行 WAL checkpoint，确保所有数据进入主文件
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("备份失败(WAL checkpoint): {}", e))?;

    // 使用 VACUUM INTO 创建完整、自包含的数据库副本。
    // 比 fs::copy 更可靠：
    // 1. 通过 SQLite 引擎读取数据，WAL 中的数据不会丢失
    // 2. 生成的是不含 WAL 模式的干净数据库，恢复时不会有 WAL 兼容问题
    // 3. 原子操作——要么完全成功，要么不写任何数据
    let escaped = dest_path.replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
        .map_err(|e| format!("备份失败: {}", e))?;

    Ok(dest_path)
}

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
    if let Some(cleanup_warning) = result.cleanup_warning {
        message.push_str(&format!(
            "\n恢复已成功，但临时文件清理失败: {cleanup_warning}"
        ));
    }
    Ok(message)
}

#[tauri::command]
fn get_database_info(state: tauri::State<'_, Database>) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let file_size_bytes = fs::metadata(&state.db_path)
        .map(|m| m.len())
        .unwrap_or(0);

    let chain_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM chains", [], |row| row.get(0))
        .unwrap_or(0);
    let focus_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM focus_sessions", [], |row| row.get(0))
        .unwrap_or(0);
    let reservation_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM reservation_sessions", [], |row| row.get(0))
        .unwrap_or(0);
    let precedent_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM precedents", [], |row| row.get(0))
        .unwrap_or(0);
    let formula_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM rsip_formulas", [], |row| row.get(0))
        .unwrap_or(0);
    let event_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM formula_events", [], |row| row.get(0))
        .unwrap_or(0);
    let goal_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM rsip_goals", [], |row| row.get(0))
        .unwrap_or(0);
    let failure_path_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM rsip_failure_paths", [], |row| row.get(0))
        .unwrap_or(0);

    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    Ok(serde_json::json!({
        "db_path": state.db_path.to_string_lossy(),
        "file_size_bytes": file_size_bytes,
        "version": version,
        "tables": {
            "chains": chain_count,
            "focus_sessions": focus_count,
            "reservation_sessions": reservation_count,
            "precedents": precedent_count,
            "rsip_formulas": formula_count,
            "formula_events": event_count,
            "rsip_goals": goal_count,
            "rsip_failure_paths": failure_path_count
        }
    }))
}

#[tauri::command]
fn export_history_json(state: tauri::State<'_, Database>) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let export_table = |sql: &str| -> Result<Vec<serde_json::Value>, String> {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let column_names: Vec<String> = stmt
            .column_names()
            .iter()
            .map(|c| c.to_string())
            .collect();
        let rows = stmt
            .query_map([], |row| {
                let mut obj = serde_json::Map::new();
                for (i, col) in column_names.iter().enumerate() {
                    let val: rusqlite::Result<String> = row.get(i);
                    obj.insert(
                        col.clone(),
                        serde_json::Value::String(val.unwrap_or_default()),
                    );
                }
                Ok(serde_json::Value::Object(obj))
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    };

    let focus_sessions = export_table(
        "SELECT id, chain_id, started_at, expected_end_at, ended_at, duration_minutes, result, failure_note, trigger_action, completion_condition, debug_category, debug_note, created_at FROM focus_sessions ORDER BY id",
    )?;
    let reservation_sessions = export_table(
        "SELECT id, chain_id, created_at, due_at, confirmation_due_at, fulfilled_at, result, failure_note, trigger_action, completion_condition, debug_category, debug_note FROM reservation_sessions ORDER BY id",
    )?;
    let precedents = export_table(
        "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, status, created_at, updated_at, retired_at FROM precedents ORDER BY id",
    )?;
    let formula_events = export_table(
        "SELECT id, formula_id, event_type, note, created_at FROM formula_events ORDER BY id",
    )?;
    let rsip_goals = export_table(
        "SELECT id, title, description, status, created_at, updated_at, archived_at FROM rsip_goals ORDER BY id",
    )?;
    let rsip_failure_paths = export_table(
        "SELECT id, goal_id, title, nodes_json, created_at, updated_at FROM rsip_failure_paths ORDER BY id",
    )?;
    let chains = export_table(
        "SELECT id, name, description, trigger_action, completion_condition, focus_duration_minutes, auxiliary_trigger_action, auxiliary_delay_minutes, auxiliary_completion_condition, auxiliary_current_length, auxiliary_best_length, current_length, best_length, status, created_at, updated_at FROM chains ORDER BY id",
    )?;
    let app_settings = export_table(
        "SELECT key, value FROM app_settings ORDER BY key",
    )?;

    let db_version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    Ok(serde_json::json!({
        "export_version": 1,
        "app_version": env!("CARGO_PKG_VERSION"),
        "exported_at": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        "database_user_version": db_version,
        "tables": {
            "chains": chains,
            "focus_sessions": focus_sessions,
            "reservation_sessions": reservation_sessions,
            "precedents": precedents,
            "formula_events": formula_events,
            "rsip_goals": rsip_goals,
            "rsip_failure_paths": rsip_failure_paths,
            "app_settings": app_settings
        }
    }))
}

#[tauri::command]
fn reset_history_and_progress(state: tauri::State<'_, Database>) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let before = conn
        .query_row("SELECT COUNT(*) FROM focus_sessions", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap_or(0)
        + conn
            .query_row("SELECT COUNT(*) FROM reservation_sessions", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0)
        + conn
            .query_row("SELECT COUNT(*) FROM formula_events", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0);

    conn.execute("DELETE FROM focus_sessions", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM reservation_sessions", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM formula_events", [])
        .map_err(|e| e.to_string())?;

    // Reset chain counters
    conn.execute(
        "UPDATE chains SET current_length = 0, best_length = 0, auxiliary_current_length = 0, auxiliary_best_length = 0, updated_at = datetime('now')",
        [],
    )
    .map_err(|e| e.to_string())?;

    let remaining_chains: i64 = conn
        .query_row("SELECT COUNT(*) FROM chains", [], |row| row.get(0))
        .unwrap_or(0);
    let remaining_precedents: i64 = conn
        .query_row("SELECT COUNT(*) FROM precedents", [], |row| row.get(0))
        .unwrap_or(0);
    let remaining_formulas: i64 = conn
        .query_row("SELECT COUNT(*) FROM rsip_formulas", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(serde_json::json!({
        "deleted_records": before,
        "remaining": {
            "chains": remaining_chains,
            "precedents": remaining_precedents,
            "rsip_formulas": remaining_formulas
        }
    }))
}

#[tauri::command]
fn get_db_version(state: tauri::State<'_, Database>) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_export_file(path: String, content: String) -> Result<String, String> {
    let dest = Path::new(&path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建目录: {}", e))?;
    }
    fs::write(dest, &content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let database = Database::new(app_dir).expect("failed to initialize database");
            app.manage(database);

            // --- System tray ---
            let open_item = MenuItemBuilder::with_id("open", "打开 Protocol").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出 Protocol").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    if event.id() == "open" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    } else if event.id() == "quit" {
                        // Direct exit — the user explicitly chose "退出"
                        // from the tray menu. Active-session state is
                        // preserved in the database.
                        app.exit(0);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_chain,
            update_chain,
            get_chain,
            get_chains,
            get_global_active_focus_session,
            set_focus_session_pending_ruling,
            clear_focus_session_pending_ruling,
            start_focus_session,
            get_active_focus_session,
            complete_focus_session,
            fail_focus_session_reset,
            fail_focus_session_precedent,
            get_chain_precedents,
            get_chain_reservation_precedents,
            get_precedent,
            update_precedent,
            retire_precedent,
            get_global_active_reservation_session,
            start_reservation_session,
            fulfill_reservation_and_start_focus,
            expire_reservation_session,
            fail_reservation_session_reset,
            fail_reservation_session_precedent,
            get_dashboard_summary,
            get_recent_protocol_events,
            create_rsip_formula,
            get_rsip_formulas,
            create_rsip_goal,
            get_rsip_goals,
            update_rsip_goal,
            archive_rsip_goal,
            create_failure_path,
            get_failure_paths,
            create_formula_from_goal,
            get_formulas_by_goal,
            update_rsip_formula,
            activate_rsip_formula,
            deactivate_rsip_formula,
            get_formula_events,
            get_rsip_formula_review,
            get_rsip_summary,
            get_protocol_timeline,
            get_app_settings,
            update_app_setting,
            backup_database,
            restore_database,
            inspect_backup_file,
            discard_restore_preview,
            discard_pending_restore_previews,
            get_database_info,
            export_history_json,
            reset_history_and_progress,
            get_db_version,
            save_export_file,
            get_chain_review_stats,
            get_failure_debug_summary,
            get_precedent_review_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod restore_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reservation_phase_uses_confirmation_window() {
        assert_eq!(
            reservation_phase_from_times(
                "2026-06-03 10:00:00",
                Some("2026-06-03 10:03:00"),
                None,
                "2026-06-03 09:59:59",
            ),
            "countdown"
        );
        assert_eq!(
            reservation_phase_from_times(
                "2026-06-03 10:00:00",
                Some("2026-06-03 10:03:00"),
                None,
                "2026-06-03 10:01:00",
            ),
            "confirming"
        );
        assert_eq!(
            reservation_phase_from_times(
                "2026-06-03 10:00:00",
                Some("2026-06-03 10:03:00"),
                Some(PENDING_RULING_NOTE),
                "2026-06-03 10:01:00",
            ),
            "pending_ruling"
        );
    }

    #[test]
    fn reservation_failure_waits_for_confirmation_due_at() {
        assert!(!reservation_failure_is_due(
            "2026-06-03 10:00:00",
            Some("2026-06-03 10:03:00"),
            "2026-06-03 10:02:59",
        ));
        assert!(reservation_failure_is_due(
            "2026-06-03 10:00:00",
            Some("2026-06-03 10:03:00"),
            "2026-06-03 10:03:00",
        ));
        assert!(reservation_failure_is_due(
            "2026-06-03 10:00:00",
            None,
            "2026-06-03 10:00:00",
        ));
    }

    #[test]
    fn reservation_ruling_guard_rejects_countdown_phase() {
        let conn = reservation_guard_test_conn(
            "datetime('now', '+5 minutes')",
            "datetime('now', '+8 minutes')",
            None,
        );

        let result = prepare_reservation_ruling(&conn, 1);

        assert_eq!(result.unwrap_err(), "辅助链确认窗口尚未结束");
        let note: Option<String> = conn
            .query_row(
                "SELECT failure_note FROM reservation_sessions WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(note, None);
    }

    #[test]
    fn reservation_ruling_guard_rejects_confirming_phase() {
        let conn = reservation_guard_test_conn(
            "datetime('now', '-1 minute')",
            "datetime('now', '+2 minutes')",
            None,
        );

        let result = prepare_reservation_ruling(&conn, 1);

        assert_eq!(result.unwrap_err(), "辅助链确认窗口尚未结束");
    }

    #[test]
    fn reservation_ruling_guard_marks_overdue_as_pending() {
        let conn = reservation_guard_test_conn(
            "datetime('now', '-5 minutes')",
            "datetime('now', '-2 minutes')",
            None,
        );

        let chain_id = prepare_reservation_ruling(&conn, 1).unwrap();

        assert_eq!(chain_id, 42);
        let note: Option<String> = conn
            .query_row(
                "SELECT failure_note FROM reservation_sessions WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(note.as_deref(), Some(PENDING_RULING_NOTE));
    }

    #[test]
    fn reservation_ruling_guard_allows_existing_pending_ruling() {
        let conn = reservation_guard_test_conn(
            "datetime('now', '+5 minutes')",
            "datetime('now', '+8 minutes')",
            Some(PENDING_RULING_NOTE),
        );

        let chain_id = prepare_reservation_ruling(&conn, 1).unwrap();

        assert_eq!(chain_id, 42);
    }

    #[test]
    fn overdue_reservation_enters_pending_ruling() {
        assert_eq!(
            reservation_result_after_confirmation_deadline(),
            (None, Some(PENDING_RULING_NOTE.to_string()))
        );
    }

    #[test]
    fn reservation_reset_ruling_breaks_auxiliary_chain() {
        assert_eq!(auxiliary_length_after_reservation_reset_ruling(4), 0);
    }

    #[test]
    fn reservation_precedent_ruling_preserves_auxiliary_chain() {
        assert_eq!(auxiliary_length_after_reservation_precedent_ruling(4), 4);
    }

    #[test]
    fn retired_precedents_are_hidden_from_active_boundaries() {
        let precedents = vec![("通讯 / 消息打断", "active"), ("临时照顾家人", "retired")];

        let active = active_precedent_titles(precedents);

        assert_eq!(active, vec!["通讯 / 消息打断".to_string()]);
    }

    #[test]
    fn retired_precedent_cannot_be_edited() {
        let conn = precedent_guard_test_conn("retired");

        let result = ensure_precedent_can_update(&conn, 1);

        assert_eq!(result.unwrap_err(), "已废止判例不能编辑");
    }

    #[test]
    fn active_precedent_can_be_edited() {
        let conn = precedent_guard_test_conn("active");

        assert!(ensure_precedent_can_update(&conn, 1).is_ok());
    }

    #[test]
    fn second_precedent_retire_keeps_existing_retired_at() {
        let conn = precedent_guard_test_conn("retired");
        let before: Option<String> = conn
            .query_row(
                "SELECT retired_at FROM precedents WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let retired = retire_precedent_record(&conn, 1).unwrap();
        let after: Option<String> = conn
            .query_row(
                "SELECT retired_at FROM precedents WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(retired["status"].as_str(), Some("retired"));
        assert_eq!(before, after);
    }

    #[test]
    fn rsip_formula_edit_rejects_empty_title() {
        assert!(clean_rsip_formula_edit("  ", "执行说明").is_err());
    }

    #[test]
    fn rsip_formula_edit_trims_title_and_description() {
        let cleaned = clean_rsip_formula_edit("  饭后洗碗  ", "  十分钟内完成  ").unwrap();
        assert_eq!(
            cleaned,
            ("饭后洗碗".to_string(), "十分钟内完成".to_string())
        );
    }

    #[test]
    fn rsip_deactivation_note_uses_default_when_blank() {
        assert_eq!(
            clean_rsip_deactivation_note(Some("  ".to_string())),
            "用户裁定该定式当前熄灭".to_string()
        );
    }

    #[test]
    fn rsip_goal_input_rejects_empty_title() {
        assert!(clean_rsip_goal_input("  ", "sleep earlier").is_err());
    }

    #[test]
    fn rsip_goal_input_trims_title_and_description() {
        let cleaned =
            clean_rsip_goal_input("  Sleep earlier  ", "  Reduce bedtime drift  ").unwrap();

        assert_eq!(
            cleaned,
            (
                "Sleep earlier".to_string(),
                "Reduce bedtime drift".to_string()
            )
        );
    }

    #[test]
    fn failure_path_nodes_json_preserves_ordered_nodes() {
        let json = failure_path_nodes_json(vec![
            "Shower done".to_string(),
            "Lie down".to_string(),
            "Pick up phone".to_string(),
        ])
        .unwrap();

        assert!(json.contains("\"id\":\"node-1\""));
        assert!(json.contains("\"text\":\"Shower done\""));
        assert!(json.contains("\"id\":\"node-3\""));
        assert!(json.contains("\"text\":\"Pick up phone\""));
    }

    #[test]
    fn failure_path_nodes_json_rejects_blank_paths() {
        assert!(failure_path_nodes_json(vec![" ".to_string(), "\t".to_string()]).is_err());
    }

    #[test]
    fn child_formula_requires_dependency_note() {
        assert!(clean_goal_formula_dependency(Some(1), Some("  ".to_string())).is_err());
        assert_eq!(
            clean_goal_formula_dependency(
                Some(1),
                Some("  parent failure destabilizes this  ".to_string())
            )
            .unwrap(),
            Some("parent failure destabilizes this".to_string())
        );
        assert_eq!(clean_goal_formula_dependency(None, None).unwrap(), None);
    }

    #[test]
    fn goal_formula_rows_are_queryable_by_goal() {
        let conn = rsip_goal_test_conn();
        let goal_id = insert_rsip_goal_record(&conn, "Sleep earlier", "Reduce bedtime drift").unwrap();
        let path_id = insert_failure_path_record(
            &conn,
            goal_id,
            "Bedtime drift path",
            vec!["Shower done".to_string(), "Pick up phone".to_string()],
        )
        .unwrap();

        let formula = insert_goal_formula_record(
            &conn,
            goal_id,
            path_id,
            "node-2".to_string(),
            "Phone stays off bed".to_string(),
            "Before bed, put the phone on the desk charger".to_string(),
            None,
            None,
        )
        .unwrap();

        let formulas = get_goal_formula_records(&conn, goal_id).unwrap();
        assert_eq!(formulas.len(), 1);
        assert_eq!(formulas[0]["id"], formula["id"]);
        assert_eq!(formulas[0]["goal_id"].as_i64(), Some(goal_id));
        assert_eq!(formulas[0]["intervention_node_id"].as_str(), Some("node-2"));
    }

    fn rsip_goal_test_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE rsip_goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                archived_at TEXT
            );

            CREATE TABLE rsip_failure_paths (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                goal_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                nodes_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE rsip_formulas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_id INTEGER,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'inactive',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                activated_at TEXT,
                deactivated_at TEXT,
                goal_id INTEGER,
                failure_path_id INTEGER,
                intervention_node_id TEXT,
                dependency_note TEXT
            );

            CREATE TABLE formula_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                formula_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ",
        )
        .unwrap();
        conn
    }

    fn reservation_guard_test_conn(
        due_expr: &str,
        confirmation_expr: &str,
        failure_note: Option<&str>,
    ) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE reservation_sessions (
                id INTEGER PRIMARY KEY,
                chain_id INTEGER NOT NULL,
                due_at TEXT NOT NULL,
                confirmation_due_at TEXT,
                result TEXT,
                failure_note TEXT,
                debug_category TEXT,
                debug_note TEXT
            );",
        )
        .unwrap();
        conn.execute(
            &format!(
                "INSERT INTO reservation_sessions (
                    id, chain_id, due_at, confirmation_due_at, failure_note
                 ) VALUES (1, 42, {due_expr}, {confirmation_expr}, ?1)"
            ),
            [failure_note],
        )
        .unwrap();
        conn
    }

    fn precedent_guard_test_conn(status: &str) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE precedents (
                id INTEGER PRIMARY KEY,
                chain_id INTEGER NOT NULL,
                scope TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                created_from_session_id INTEGER,
                created_from_session_type TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT,
                retired_at TEXT
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO precedents (
                id, chain_id, scope, title, description, status, retired_at
             ) VALUES (
                1, 1, 'main_chain', '边界', '描述', ?1,
                CASE WHEN ?1 = 'retired' THEN '2026-06-03 10:00:00' ELSE NULL END
             )",
            [status],
        )
        .unwrap();
        conn
    }
}
