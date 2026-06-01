mod db;

use db::Database;
use tauri::Manager;

const PENDING_RULING_NOTE: &str = "__pending_ruling__";
const AUXILIARY_EXPIRED_NOTE: &str = "未在预约时间内进入主链";
const CHAIN_FIELDS: &str = "id, name, description, trigger_action, completion_condition, focus_duration_minutes, auxiliary_trigger_action, auxiliary_delay_minutes, auxiliary_completion_condition, current_length, best_length, status, created_at, updated_at";

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
        "current_length": row.get::<_, i64>(9)?,
        "best_length": row.get::<_, i64>(10)?,
        "status": row.get::<_, String>(11)?,
        "created_at": row.get::<_, String>(12)?,
        "updated_at": row.get::<_, String>(13)?,
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

fn expire_overdue_reservation_sessions(conn: &rusqlite::Connection) -> Result<usize, String> {
    conn.execute(
        "UPDATE reservation_sessions
         SET result = 'failed_reset',
             failure_note = ?1,
             debug_category = NULL,
             debug_note = NULL
         WHERE result IS NULL AND datetime(due_at) <= datetime('now')",
        [AUXILIARY_EXPIRED_NOTE],
    )
    .map_err(|e| e.to_string())
}

fn reservation_failure_result_json(
    conn: &rusqlite::Connection,
    reservation_id: i64,
    chain_id: i64,
) -> Result<serde_json::Value, String> {
    let session = conn.query_row(
        "SELECT id, chain_id, created_at, due_at, fulfilled_at, result, failure_note, trigger_action, completion_condition, debug_category, debug_note FROM reservation_sessions WHERE id = ?1",
        [reservation_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
                "fulfilled_at": row.get::<_, Option<String>>(4)?,
                "result": row.get::<_, Option<String>>(5)?,
                "failure_note": row.get::<_, Option<String>>(6)?,
                "trigger_action": row.get::<_, String>(7)?,
                "completion_condition": row.get::<_, String>(8)?,
                "debug_category": row.get::<_, Option<String>>(9)?,
                "debug_note": row.get::<_, Option<String>>(10)?,
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
             SET result = 'failed_reset',
                 failure_note = ?2,
                 debug_category = NULL,
                 debug_note = NULL
             WHERE id = ?1 AND result IS NULL AND datetime(due_at) <= datetime('now')",
            rusqlite::params![reservation_id, AUXILIARY_EXPIRED_NOTE],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("辅助链预约窗口尚未结束".into());
    }

    reservation_failure_result_json(conn, reservation_id, chain_id)
}

#[tauri::command]
fn get_db_status(state: tauri::State<'_, Database>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute_batch("SELECT 1")
        .map(|_| "connected".to_string())
        .map_err(|e| e.to_string())
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
    let auxiliary_trigger_action = clean_required(auxiliary_trigger_action, "辅助链触发动作不能为空")?;
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
    let auxiliary_trigger_action = clean_required(auxiliary_trigger_action, "辅助链触发动作不能为空")?;
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
        .prepare(&format!("SELECT {} FROM chains ORDER BY created_at DESC", CHAIN_FIELDS))
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], chain_json)
        .map_err(|e| e.to_string())?;

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
        "INSERT INTO precedents (chain_id, scope, title, description, created_from_session_id, created_from_session_type) VALUES (?1, 'main_chain', ?2, ?3, ?4, 'focus')",
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
        "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, created_at FROM precedents WHERE id = ?1",
        [precedent_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "scope": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "description": row.get::<_, String>(4)?,
                "created_from_session_id": row.get::<_, Option<i64>>(5)?,
                "created_from_session_type": row.get::<_, Option<String>>(6)?,
                "created_at": row.get::<_, String>(7)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "session": session,
        "chain": chain,
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
        .prepare("SELECT id, chain_id, scope, title, description, created_at FROM precedents WHERE chain_id = ?1 AND scope = 'main_chain' ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([chain_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "scope": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "description": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?,
            }))
        })
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
        .prepare("SELECT id, chain_id, scope, title, description, created_at FROM precedents WHERE chain_id = ?1 AND scope = 'reservation_chain' ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([chain_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "scope": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "description": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut precedents = Vec::new();
    for row in rows {
        precedents.push(row.map_err(|e| e.to_string())?);
    }
    Ok(precedents)
}

#[tauri::command]
fn get_global_active_reservation_session(
    state: tauri::State<'_, Database>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    expire_overdue_reservation_sessions(&conn)?;
    let result = conn
        .query_row(
            "SELECT r.id, r.chain_id, r.created_at, r.due_at, c.name as chain_name, r.failure_note, r.trigger_action, r.completion_condition
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
                    "chain_name": row.get::<_, String>(4)?,
                    "pending_ruling": row.get::<_, Option<String>>(5)?.as_deref() == Some(PENDING_RULING_NOTE),
                    "trigger_action": row.get::<_, String>(6)?,
                    "completion_condition": row.get::<_, String>(7)?,
                }))
            },
        )
        .ok();
    Ok(result)
}

#[tauri::command]
fn set_reservation_session_pending_ruling(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let rows = conn
        .execute(
            "UPDATE reservation_sessions SET failure_note = ?2 WHERE id = ?1 AND result IS NULL",
            rusqlite::params![reservation_id, PENDING_RULING_NOTE],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("reservation session is not active".into());
    }
    Ok(())
}

#[tauri::command]
fn clear_reservation_session_pending_ruling(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE reservation_sessions SET failure_note = NULL WHERE id = ?1 AND result IS NULL AND failure_note = ?2",
        rusqlite::params![reservation_id, PENDING_RULING_NOTE],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
        "INSERT INTO reservation_sessions (chain_id, due_at, trigger_action, completion_condition) VALUES (?1, datetime('now', ?2), ?3, ?4)",
        rusqlite::params![
            chain_id,
            format!("+{} minutes", delay_minutes),
            trigger_action,
            completion_condition
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, chain_id, created_at, due_at, trigger_action, completion_condition FROM reservation_sessions WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
                "trigger_action": row.get::<_, String>(4)?,
                "completion_condition": row.get::<_, String>(5)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_active_reservation_session(
    state: tauri::State<'_, Database>,
    chain_id: i64,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    expire_overdue_reservation_sessions(&conn)?;
    let result = conn
        .query_row(
            "SELECT id, chain_id, created_at, due_at, trigger_action, completion_condition FROM reservation_sessions
             WHERE chain_id = ?1 AND result IS NULL
             ORDER BY created_at DESC LIMIT 1",
            [chain_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "chain_id": row.get::<_, i64>(1)?,
                    "created_at": row.get::<_, String>(2)?,
                    "due_at": row.get::<_, String>(3)?,
                    "trigger_action": row.get::<_, String>(4)?,
                    "completion_condition": row.get::<_, String>(5)?,
                }))
            },
        )
        .ok();
    Ok(result)
}

#[tauri::command]
fn fulfill_reservation_and_start_focus(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
) -> Result<serde_json::Value, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    let (chain_id, focus_dur, trigger_action, completion_condition, due_at): (i64, i64, String, String, String) = conn
        .query_row(
            "SELECT r.chain_id, c.focus_duration_minutes, c.trigger_action, c.completion_condition, r.due_at
             FROM reservation_sessions r
             JOIN chains c ON c.id = r.chain_id
             WHERE r.id = ?1 AND r.result IS NULL",
            [reservation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .map_err(|_| "辅助链不存在或已结束".to_string())?;

    let due_past: bool = conn
        .query_row(
            "SELECT datetime(?) <= datetime('now')",
            [&due_at],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if due_past {
        let _ = expire_reservation_session_by_id(&conn, reservation_id)?;
        return Err("辅助链预约窗口已结束，已自动记录失败".into());
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
fn fail_reservation_session_reset(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
    behavior_type: Option<String>,
    debug_category: Option<String>,
    debug_note: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let failure_note = behavior_note(behavior_type);
    let debug_category = optional_note(debug_category);
    let debug_note = optional_note(debug_note);

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM reservation_sessions WHERE id = ?1 AND result IS NULL",
            [reservation_id],
            |row| row.get(0),
        )
        .map_err(|_| "预约不存在或已结束".to_string())?;

    conn.execute(
        "UPDATE reservation_sessions
         SET result = 'failed_reset',
             failure_note = ?2,
             debug_category = ?3,
             debug_note = ?4
         WHERE id = ?1",
        rusqlite::params![reservation_id, failure_note, debug_category, debug_note],
    )
    .map_err(|e| e.to_string())?;

    let session = conn.query_row(
        "SELECT id, chain_id, created_at, due_at, fulfilled_at, result, failure_note, trigger_action, completion_condition, debug_category, debug_note FROM reservation_sessions WHERE id = ?1",
        [reservation_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
                "fulfilled_at": row.get::<_, Option<String>>(4)?,
                "result": row.get::<_, Option<String>>(5)?,
                "failure_note": row.get::<_, Option<String>>(6)?,
                "trigger_action": row.get::<_, String>(7)?,
                "completion_condition": row.get::<_, String>(8)?,
                "debug_category": row.get::<_, Option<String>>(9)?,
                "debug_note": row.get::<_, Option<String>>(10)?,
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
fn precedent_reservation_session_failure(
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

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM reservation_sessions WHERE id = ?1 AND result IS NULL",
            [reservation_id],
            |row| row.get(0),
        )
        .map_err(|_| "预约不存在或已结束".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE reservation_sessions
         SET result = 'failed_precedent',
             failure_note = ?2,
             debug_category = ?3,
             debug_note = ?4
         WHERE id = ?1",
        rusqlite::params![reservation_id, failure_note, debug_category, debug_note],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO precedents (chain_id, scope, title, description, created_from_session_id, created_from_session_type) VALUES (?1, 'reservation_chain', ?2, ?3, ?4, 'reservation')",
        rusqlite::params![chain_id, title.trim(), description.trim(), reservation_id],
    )
    .map_err(|e| e.to_string())?;

    let precedent_id = tx.last_insert_rowid();
    tx.commit().map_err(|e| e.to_string())?;

    let session = conn.query_row(
        "SELECT id, chain_id, created_at, due_at, fulfilled_at, result, failure_note, trigger_action, completion_condition, debug_category, debug_note FROM reservation_sessions WHERE id = ?1",
        [reservation_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
                "fulfilled_at": row.get::<_, Option<String>>(4)?,
                "result": row.get::<_, Option<String>>(5)?,
                "failure_note": row.get::<_, Option<String>>(6)?,
                "trigger_action": row.get::<_, String>(7)?,
                "completion_condition": row.get::<_, String>(8)?,
                "debug_category": row.get::<_, Option<String>>(9)?,
                "debug_note": row.get::<_, Option<String>>(10)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let chain = get_chain_json(&conn, chain_id)?;

    let precedent = conn.query_row(
        "SELECT id, chain_id, scope, title, description, created_from_session_id, created_from_session_type, created_at FROM precedents WHERE id = ?1",
        [precedent_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "scope": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "description": row.get::<_, String>(4)?,
                "created_from_session_id": row.get::<_, Option<i64>>(5)?,
                "created_from_session_type": row.get::<_, Option<String>>(6)?,
                "created_at": row.get::<_, String>(7)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "session": session,
        "chain": chain,
        "precedent": precedent,
    }))
}

#[tauri::command]
fn get_setting(state: tauri::State<'_, Database>, key: String) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT value FROM app_settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_row([&key], |row| row.get::<_, String>(0))
        .ok();
    Ok(result)
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
        .query_row("SELECT COUNT(*) FROM chains WHERE status = 'active'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let max_length: i64 = conn
        .query_row("SELECT COALESCE(MAX(current_length), 0) FROM chains WHERE status = 'active'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let today_completed: i64 = conn
        .query_row("SELECT COUNT(*) FROM focus_sessions WHERE date(created_at) = date('now') AND result = 'completed'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let total_completed: i64 = conn
        .query_row("SELECT COUNT(*) FROM focus_sessions WHERE result = 'completed'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let active_focus: Option<(i64, String, Option<String>)> = conn.query_row(
        "SELECT f.chain_id, c.name, f.failure_note FROM focus_sessions f JOIN chains c ON c.id = f.chain_id WHERE f.result IS NULL LIMIT 1",
        [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?)),
    ).ok();

    let active_reservation: Option<(i64, String, String, Option<String>)> = conn.query_row(
        "SELECT r.chain_id, c.name, r.due_at, r.failure_note FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id WHERE r.result IS NULL LIMIT 1",
        [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?)),
    ).ok();

    let (state, active_chain_id, active_chain_name) = if let Some((fid, fname, note)) = active_focus {
        let state_str = if note.as_deref() == Some(PENDING_RULING_NOTE) {
            "focus_pending_ruling"
        } else {
            "focus"
        };
        (state_str.to_string(), Some(fid), Some(fname))
    } else if let Some((rid, rname, _due, _note)) = active_reservation {
        let state_str = "reservation_countdown";
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
    let mut stmt = conn.prepare(
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
         ORDER BY event_time DESC LIMIT 8"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
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
    }).map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(|e| e.to_string())?);
    }
    Ok(events)
}

#[tauri::command]
fn get_protocol_history(
    state: tauri::State<'_, Database>,
    type_filter: Option<String>,
    result_filter: Option<String>,
    chain_id: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT 'focus' AS event_type, f.id, f.chain_id, c.name AS chain_name,
                f.started_at AS event_time, f.ended_at, f.result, f.duration_minutes
         FROM focus_sessions f JOIN chains c ON c.id = f.chain_id
         WHERE f.result IS NOT NULL
         UNION ALL
         SELECT 'reservation' AS event_type, r.id, r.chain_id, c.name AS chain_name,
                r.created_at AS event_time, r.fulfilled_at AS ended_at, r.result, NULL
         FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id
         WHERE r.result IS NOT NULL"
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut outer_where = Vec::new();

    if let Some(ref tf) = type_filter {
        if tf == "focus" {
            outer_where.push(format!("event_type = 'focus'"));
        } else if tf == "reservation" {
            outer_where.push(format!("event_type = 'reservation'"));
        }
    }
    if let Some(ref rf) = result_filter {
        if rf == "success" {
            outer_where.push(format!("result IN ('completed', 'fulfilled')"));
        } else if rf == "failed" {
            outer_where.push(format!("result IN ('failed_reset')"));
        } else if rf == "precedent" {
            outer_where.push(format!("result IN ('failed_precedent')"));
        }
    }
    if let Some(cid) = chain_id {
        params.push(Box::new(cid));
        outer_where.push(format!("chain_id = ?{}", params.len()));
    }

    if !outer_where.is_empty() {
        sql = format!(
            "SELECT * FROM ({}) WHERE {} ORDER BY event_time DESC",
            sql,
            outer_where.join(" AND ")
        );
    } else {
        sql = format!("SELECT * FROM ({}) ORDER BY event_time DESC", sql);
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
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
    }).map_err(|e| e.to_string())?;

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
        "SELECT id, parent_id, title, description, status, position, created_at, updated_at, activated_at, deactivated_at FROM rsip_formulas WHERE id = ?1",
        [id],
        |row| {
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
            }))
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_rsip_formulas(state: tauri::State<'_, Database>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, title, description, status, position, created_at, updated_at, activated_at, deactivated_at
             FROM rsip_formulas
             ORDER BY COALESCE(parent_id, 0), position, created_at",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
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
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut formulas = Vec::new();
    for row in rows {
        formulas.push(row.map_err(|e| e.to_string())?);
    }
    Ok(formulas)
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
        "SELECT id, parent_id, title, description, status, position, created_at, updated_at, activated_at, deactivated_at FROM rsip_formulas WHERE id = ?1",
        [id],
        |row| {
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
            }))
        },
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

    let clean_note = note.unwrap_or_default().trim().to_string();
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
        .prepare(
            "SELECT id, parent_id, title, description, status, position, created_at, updated_at, activated_at, deactivated_at
             FROM rsip_formulas
             ORDER BY COALESCE(parent_id, 0), position, created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
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
            }))
        })
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
        .query_map([safe_limit], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "formula_id": row.get::<_, i64>(1)?,
                "formula_title": row.get::<_, String>(2)?,
                "event_type": row.get::<_, String>(3)?,
                "note": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?,
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
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "formula_id": row.get::<_, i64>(1)?,
                    "formula_title": row.get::<_, String>(2)?,
                    "event_type": row.get::<_, String>(3)?,
                    "note": row.get::<_, String>(4)?,
                    "created_at": row.get::<_, String>(5)?,
                }))
            },
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
            filters.push("result IN ('completed', 'fulfilled', 'activated', 'created')".to_string());
        } else if rf == "failed" {
            filters.push("result IN ('failed_reset', 'deactivated', 'rollback_child_deactivated')".to_string());
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
    sql = format!("{} ORDER BY event_time DESC, id DESC LIMIT ?{}", sql, params.len());

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let database = Database::new(app_dir).expect("failed to initialize database");
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_db_status,
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
            get_global_active_reservation_session,
            set_reservation_session_pending_ruling,
            clear_reservation_session_pending_ruling,
            start_reservation_session,
            get_active_reservation_session,
            fulfill_reservation_and_start_focus,
            expire_reservation_session,
            fail_reservation_session_reset,
            precedent_reservation_session_failure,
            get_dashboard_summary,
            get_recent_protocol_events,
            get_protocol_history,
            create_rsip_formula,
            get_rsip_formulas,
            activate_rsip_formula,
            deactivate_rsip_formula,
            get_formula_events,
            get_rsip_summary,
            get_protocol_timeline,
            get_setting,
            get_app_settings,
            update_app_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
