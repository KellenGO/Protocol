mod db;

use db::Database;
use tauri::Manager;

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
    focus_duration_minutes: i64,
) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("链名称不能为空".into());
    }
    if focus_duration_minutes < 1 {
        return Err("专注时长必须为正整数".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO chains (name, description, focus_duration_minutes) VALUES (?1, ?2, ?3)",
        rusqlite::params![name.trim(), description.trim(), focus_duration_minutes],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "focus_duration_minutes": row.get::<_, i64>(3)?,
                "current_length": row.get::<_, i64>(4)?,
                "best_length": row.get::<_, i64>(5)?,
                "status": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_chain(
    state: tauri::State<'_, Database>,
    id: i64,
    name: String,
    description: String,
    focus_duration_minutes: i64,
) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() {
        return Err("主链名称不能为空".into());
    }
    if focus_duration_minutes < 1 {
        return Err("专注时长必须为正整数".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let rows = conn
        .execute(
            "UPDATE chains SET name = ?1, description = ?2, focus_duration_minutes = ?3, updated_at = datetime('now') WHERE id = ?4",
            rusqlite::params![name.trim(), description.trim(), focus_duration_minutes, id],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err("链不存在".into());
    }

    conn.query_row(
        "SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "focus_duration_minutes": row.get::<_, i64>(3)?,
                "current_length": row.get::<_, i64>(4)?,
                "best_length": row.get::<_, i64>(5)?,
                "status": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_chain(state: tauri::State<'_, Database>, id: i64) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "focus_duration_minutes": row.get::<_, i64>(3)?,
                "current_length": row.get::<_, i64>(4)?,
                "best_length": row.get::<_, i64>(5)?,
                "status": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_chains(state: tauri::State<'_, Database>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "focus_duration_minutes": row.get::<_, i64>(3)?,
                "current_length": row.get::<_, i64>(4)?,
                "best_length": row.get::<_, i64>(5)?,
                "status": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        })
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
            "SELECT f.id, f.chain_id, f.started_at, f.expected_end_at, f.duration_minutes, c.name as chain_name
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
                }))
            },
        )
        .ok();
    Ok(result)
}

#[tauri::command]
fn start_focus_session(
    state: tauri::State<'_, Database>,
    chain_id: i64,
    duration_minutes: i64,
) -> Result<serde_json::Value, String> {
    if duration_minutes < 1 {
        return Err("时长必须为正整数".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let chain_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM chains WHERE id = ?1",
            [chain_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !chain_exists {
        return Err("链不存在".into());
    }

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
        "INSERT INTO focus_sessions (chain_id, started_at, expected_end_at, duration_minutes) VALUES (?1, datetime('now'), datetime('now', ?2), ?3)",
        rusqlite::params![chain_id, format!("+{} minutes", duration_minutes), duration_minutes],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, chain_id, started_at, expected_end_at, duration_minutes FROM focus_sessions WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "started_at": row.get::<_, String>(2)?,
                "expected_end_at": row.get::<_, Option<String>>(3)?,
                "duration_minutes": row.get::<_, Option<i64>>(4)?,
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
            "SELECT id, chain_id, started_at, expected_end_at, duration_minutes
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
            "SELECT id, chain_id, started_at, expected_end_at, ended_at, duration_minutes, result FROM focus_sessions WHERE id = ?1",
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
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    let chain = conn
        .query_row(
            "SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains WHERE id = ?1",
            [chain_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "name": row.get::<_, String>(1)?,
                    "description": row.get::<_, String>(2)?,
                    "focus_duration_minutes": row.get::<_, i64>(3)?,
                    "current_length": row.get::<_, i64>(4)?,
                    "best_length": row.get::<_, i64>(5)?,
                    "status": row.get::<_, String>(6)?,
                    "created_at": row.get::<_, String>(7)?,
                    "updated_at": row.get::<_, String>(8)?,
                }))
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "session": session,
        "chain": chain,
    }))
}

#[tauri::command]
fn fail_focus_session_reset(
    state: tauri::State<'_, Database>,
    session_id: i64,
) -> Result<serde_json::Value, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM focus_sessions WHERE id = ?1 AND result IS NULL",
            [session_id],
            |row| row.get(0),
        )
        .map_err(|_| "任务不存在或已结束".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE focus_sessions SET result = 'failed_reset', ended_at = datetime('now') WHERE id = ?1",
        [session_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE chains SET current_length = 0, updated_at = datetime('now') WHERE id = ?1",
        [chain_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let session = conn.query_row(
        "SELECT id, chain_id, started_at, expected_end_at, ended_at, duration_minutes, result FROM focus_sessions WHERE id = ?1",
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
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let chain = conn.query_row(
        "SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains WHERE id = ?1",
        [chain_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "focus_duration_minutes": row.get::<_, i64>(3)?,
                "current_length": row.get::<_, i64>(4)?,
                "best_length": row.get::<_, i64>(5)?,
                "status": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

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
) -> Result<serde_json::Value, String> {
    if title.trim().is_empty() {
        return Err("判例标题不能为空".into());
    }

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM focus_sessions WHERE id = ?1 AND result IS NULL",
            [session_id],
            |row| row.get(0),
        )
        .map_err(|_| "任务不存在或已结束".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE focus_sessions SET result = 'failed_precedent', ended_at = datetime('now') WHERE id = ?1",
        [session_id],
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
        "SELECT id, chain_id, started_at, expected_end_at, ended_at, duration_minutes, result FROM focus_sessions WHERE id = ?1",
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
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let chain = conn.query_row(
        "SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains WHERE id = ?1",
        [chain_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "focus_duration_minutes": row.get::<_, i64>(3)?,
                "current_length": row.get::<_, i64>(4)?,
                "best_length": row.get::<_, i64>(5)?,
                "status": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

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
    let result = conn
        .query_row(
            "SELECT r.id, r.chain_id, r.created_at, r.due_at, c.name as chain_name
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
    delay_minutes: i64,
) -> Result<serde_json::Value, String> {
    if delay_minutes < 1 {
        return Err("预约时长必须为正整数".into());
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let chain_exists: bool = conn
        .query_row("SELECT COUNT(*) > 0 FROM chains WHERE id = ?1", [chain_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if !chain_exists {
        return Err("链不存在".into());
    }

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
        "INSERT INTO reservation_sessions (chain_id, due_at) VALUES (?1, datetime('now', ?2))",
        rusqlite::params![chain_id, format!("+{} minutes", delay_minutes)],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, chain_id, created_at, due_at FROM reservation_sessions WHERE id = ?1",
        [id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
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
    let result = conn
        .query_row(
            "SELECT id, chain_id, created_at, due_at FROM reservation_sessions
             WHERE chain_id = ?1 AND result IS NULL
             ORDER BY created_at DESC LIMIT 1",
            [chain_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "chain_id": row.get::<_, i64>(1)?,
                    "created_at": row.get::<_, String>(2)?,
                    "due_at": row.get::<_, String>(3)?,
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

    let (chain_id, focus_dur): (i64, i64) = conn
        .query_row(
            "SELECT r.chain_id, c.focus_duration_minutes
             FROM reservation_sessions r
             JOIN chains c ON c.id = r.chain_id
             WHERE r.id = ?1 AND r.result IS NULL",
            [reservation_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|_| "预约不存在或已结束".to_string())?;

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
            "INSERT INTO focus_sessions (chain_id, started_at, expected_end_at, duration_minutes) VALUES (?1, datetime('now'), datetime('now', ?2), ?3)",
            rusqlite::params![chain_id, format!("+{} minutes", focus_dur), focus_dur],
        )
        .map_err(|e| e.to_string())?;
        tx.last_insert_rowid()
    };

    tx.commit().map_err(|e| e.to_string())?;

    let focus_session = conn.query_row(
        "SELECT id, chain_id, started_at, expected_end_at, duration_minutes FROM focus_sessions WHERE id = ?1",
        [focus_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "started_at": row.get::<_, String>(2)?,
                "expected_end_at": row.get::<_, Option<String>>(3)?,
                "duration_minutes": row.get::<_, Option<i64>>(4)?,
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
fn fail_reservation_session_reset(
    state: tauri::State<'_, Database>,
    reservation_id: i64,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM reservation_sessions WHERE id = ?1 AND result IS NULL",
            [reservation_id],
            |row| row.get(0),
        )
        .map_err(|_| "预约不存在或已结束".to_string())?;

    conn.execute(
        "UPDATE reservation_sessions SET result = 'failed_reset' WHERE id = ?1",
        [reservation_id],
    )
    .map_err(|e| e.to_string())?;

    let session = conn.query_row(
        "SELECT id, chain_id, created_at, due_at, result FROM reservation_sessions WHERE id = ?1",
        [reservation_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
                "result": row.get::<_, Option<String>>(4)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let chain = conn.query_row(
        "SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains WHERE id = ?1",
        [chain_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "focus_duration_minutes": row.get::<_, i64>(3)?,
                "current_length": row.get::<_, i64>(4)?,
                "best_length": row.get::<_, i64>(5)?,
                "status": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

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
) -> Result<serde_json::Value, String> {
    if title.trim().is_empty() {
        return Err("判例标题不能为空".into());
    }

    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;

    let chain_id: i64 = conn
        .query_row(
            "SELECT chain_id FROM reservation_sessions WHERE id = ?1 AND result IS NULL",
            [reservation_id],
            |row| row.get(0),
        )
        .map_err(|_| "预约不存在或已结束".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE reservation_sessions SET result = 'failed_precedent' WHERE id = ?1",
        [reservation_id],
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
        "SELECT id, chain_id, created_at, due_at, result FROM reservation_sessions WHERE id = ?1",
        [reservation_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_at": row.get::<_, String>(3)?,
                "result": row.get::<_, Option<String>>(4)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let chain = conn.query_row(
        "SELECT id, name, description, focus_duration_minutes, current_length, best_length, status, created_at, updated_at FROM chains WHERE id = ?1",
        [chain_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, String>(2)?,
                "focus_duration_minutes": row.get::<_, i64>(3)?,
                "current_length": row.get::<_, i64>(4)?,
                "best_length": row.get::<_, i64>(5)?,
                "status": row.get::<_, String>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "updated_at": row.get::<_, String>(8)?,
            }))
        },
    )
    .map_err(|e| e.to_string())?;

    let precedent = conn.query_row(
        "SELECT id, chain_id, scope, title, description, created_at FROM precedents WHERE id = ?1",
        [precedent_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "chain_id": row.get::<_, i64>(1)?,
                "scope": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "description": row.get::<_, String>(4)?,
                "created_at": row.get::<_, String>(5)?,
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

    let active_focus: Option<(i64, String)> = conn.query_row(
        "SELECT f.chain_id, c.name FROM focus_sessions f JOIN chains c ON c.id = f.chain_id WHERE f.result IS NULL LIMIT 1",
        [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    ).ok();

    let active_reservation: Option<(i64, String, String)> = conn.query_row(
        "SELECT r.chain_id, c.name, r.due_at FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id WHERE r.result IS NULL LIMIT 1",
        [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
    ).ok();

    let (state, active_chain_id, active_chain_name) = if let Some((fid, fname)) = active_focus {
        ("focus".to_string(), Some(fid), Some(fname))
    } else if let Some((rid, rname, due)) = active_reservation {
        // Check if due_at is past
        let due_past: bool = conn.query_row(
            "SELECT datetime(?) <= datetime('now')", [&due], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        let state_str = if due_past { "reservation_due" } else { "reservation_countdown" };
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
                   f.failure_note AS note
            FROM focus_sessions f JOIN chains c ON c.id = f.chain_id
            WHERE f.result IS NOT NULL
            UNION ALL
            SELECT 'reservation' AS event_type, r.id, r.chain_id, c.name AS chain_name,
                   NULL AS formula_id, NULL AS formula_title,
                   r.created_at AS event_time, r.fulfilled_at AS ended_at, r.result, NULL AS duration_minutes,
                   r.failure_note AS note
            FROM reservation_sessions r JOIN chains c ON c.id = r.chain_id
            WHERE r.result IS NOT NULL
            UNION ALL
            SELECT 'rsip' AS event_type, e.id, NULL AS chain_id, NULL AS chain_name,
                   e.formula_id, f.title AS formula_title,
                   e.created_at AS event_time, NULL AS ended_at, e.event_type AS result, NULL AS duration_minutes,
                   e.note AS note
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
            start_focus_session,
            get_active_focus_session,
            complete_focus_session,
            fail_focus_session_reset,
            fail_focus_session_precedent,
            get_chain_precedents,
            get_chain_reservation_precedents,
            get_global_active_reservation_session,
            start_reservation_session,
            get_active_reservation_session,
            fulfill_reservation_and_start_focus,
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
