mod db;

use db::Database;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

const PENDING_RULING_NOTE: &str = "__pending_ruling__";
const CHAIN_FIELDS: &str = "id, name, description, trigger_action, completion_condition, focus_duration_minutes, auxiliary_trigger_action, auxiliary_delay_minutes, auxiliary_completion_condition, auxiliary_current_length, auxiliary_best_length, current_length, best_length, status, created_at, updated_at";
const RSIP_FORMULA_FIELDS: &str = "id, parent_id, title, description, status, position, created_at, updated_at, activated_at, deactivated_at, goal_id, failure_path_id, intervention_node_id, dependency_note";

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

#[derive(Debug)]
struct MoveSourceInfo {
    old_parent_id: Option<i64>,
    old_position: i64,
    title: String,
}

fn load_move_source(conn: &rusqlite::Connection, id: i64) -> Result<MoveSourceInfo, String> {
    conn.query_row(
        "SELECT parent_id, position, title FROM rsip_formulas WHERE id = ?1",
        [id],
        |row| {
            Ok(MoveSourceInfo {
                old_parent_id: row.get(0)?,
                old_position: row.get(1)?,
                title: row.get(2)?,
            })
        },
    )
    .map_err(|_| "定式不存在".to_string())
}

fn normalize_formula_title(title: &str) -> String {
    title.trim().to_lowercase()
}

fn has_duplicate_sibling(
    conn: &rusqlite::Connection,
    id: i64,
    new_parent_id: Option<i64>,
    title: &str,
) -> Result<bool, String> {
    let normalized = normalize_formula_title(title);
    let count: i64 = match new_parent_id {
        Some(pid) => conn.query_row(
            "SELECT COUNT(*) FROM rsip_formulas
             WHERE id != ?1 AND parent_id IS ?2 AND LOWER(TRIM(title)) = ?3",
            rusqlite::params![id, pid, normalized],
            |row| row.get(0),
        ),
        None => conn.query_row(
            "SELECT COUNT(*) FROM rsip_formulas
             WHERE id != ?1 AND parent_id IS NULL AND LOWER(TRIM(title)) = ?2",
            rusqlite::params![id, normalized],
            |row| row.get(0),
        ),
    }
    .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

fn resolve_move_position(
    tx: &rusqlite::Transaction<'_>,
    id: i64,
    new_parent_id: Option<i64>,
    new_position: Option<i64>,
) -> Result<i64, String> {
    let sibling_count: i64 = match new_parent_id {
        Some(pid) => tx.query_row(
            "SELECT COUNT(*) FROM rsip_formulas WHERE parent_id = ?1 AND id != ?2",
            rusqlite::params![pid, id],
            |row| row.get(0),
        ),
        None => tx.query_row(
            "SELECT COUNT(*) FROM rsip_formulas WHERE parent_id IS NULL AND id != ?1",
            [id],
            |row| row.get(0),
        ),
    }
    .map_err(|e| e.to_string())?;

    Ok(match new_position {
        Some(requested) => requested.clamp(0, sibling_count),
        None => sibling_count,
    })
}

fn move_rsip_formula_core(
    conn: &mut rusqlite::Connection,
    id: i64,
    new_parent_id: Option<i64>,
    new_position: Option<i64>,
    allow_status_rollback: bool,
) -> Result<serde_json::Value, String> {
    let source = load_move_source(conn, id)?;

    if let Some(pid) = new_parent_id {
        if pid == id {
            return Err("不能把节点移动到自身下".into());
        }
        let parent_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM rsip_formulas WHERE id = ?1",
                [pid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !parent_exists {
            return Err("目标父定式不存在".into());
        }
        let parent_is_descendant: bool = conn
            .query_row(
                "WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM rsip_formulas WHERE parent_id = ?1
                    UNION ALL
                    SELECT f.id FROM rsip_formulas f JOIN descendants d ON f.parent_id = d.id
                 )
                 SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
                rusqlite::params![id, pid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if parent_is_descendant {
            return Err("不能把节点移动到自己的子孙节点下".into());
        }
    }

    if has_duplicate_sibling(conn, id, new_parent_id, &source.title)? {
        return Err("目标层级下已存在同名节点".into());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let position = resolve_move_position(&tx, id, new_parent_id, new_position)?;

    // 从旧兄弟列表中移除并压缩 position
    match source.old_parent_id {
        Some(pid) => tx.execute(
            "UPDATE rsip_formulas
             SET position = position - 1, updated_at = datetime('now')
             WHERE parent_id = ?1 AND id != ?2 AND position > ?3",
            rusqlite::params![pid, id, source.old_position],
        ),
        None => tx.execute(
            "UPDATE rsip_formulas
             SET position = position - 1, updated_at = datetime('now')
             WHERE parent_id IS NULL AND id != ?1 AND position > ?2",
            rusqlite::params![id, source.old_position],
        ),
    }
    .map_err(|e| e.to_string())?;

    // 在新兄弟列表中插入位置并让位
    match new_parent_id {
        Some(pid) => tx.execute(
            "UPDATE rsip_formulas
             SET position = position + 1, updated_at = datetime('now')
             WHERE parent_id = ?1 AND id != ?2 AND position >= ?3",
            rusqlite::params![pid, id, position],
        ),
        None => tx.execute(
            "UPDATE rsip_formulas
             SET position = position + 1, updated_at = datetime('now')
             WHERE parent_id IS NULL AND id != ?1 AND position >= ?2",
            rusqlite::params![id, position],
        ),
    }
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE rsip_formulas
         SET parent_id = ?2,
             position = ?3,
             dependency_note = NULL,
             updated_at = datetime('now')
         WHERE id = ?1",
        rusqlite::params![id, new_parent_id, position],
    )
    .map_err(|e| e.to_string())?;

    let mut deactivated_ids: Vec<i64> = Vec::new();
    if let Some(pid) = new_parent_id {
        let parent_status: String = tx
            .query_row("SELECT status FROM rsip_formulas WHERE id = ?1", [pid], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        if parent_status == "inactive" {
            let active_in_subtree: Vec<i64> = {
                let mut stmt = tx
                    .prepare(
                        "WITH RECURSIVE descendants(id) AS (
                            SELECT id FROM rsip_formulas WHERE parent_id = ?1
                            UNION ALL
                            SELECT f.id FROM rsip_formulas f JOIN descendants d ON f.parent_id = d.id
                         )
                         SELECT id FROM rsip_formulas
                         WHERE id IN (SELECT id FROM descendants UNION ALL SELECT ?1)
                           AND status = 'active'
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
            if !active_in_subtree.is_empty() {
                if !allow_status_rollback {
                    return Err("目标父定式尚未点亮，移动将熄灭该节点及其已点亮子节点".into());
                }
                for child_id in &active_in_subtree {
                    tx.execute(
                        "UPDATE rsip_formulas
                         SET status = 'inactive',
                             deactivated_at = datetime('now'),
                             updated_at = datetime('now')
                         WHERE id = ?1",
                        [child_id],
                    )
                    .map_err(|e| e.to_string())?;
                    tx.execute(
                        "INSERT INTO formula_events (formula_id, event_type, note)
                         VALUES (?1, 'rollback_child_deactivated', ?2)",
                        rusqlite::params![
                            child_id,
                            format!("移动至未点亮父定式 {}，触发递归熄灭", pid)
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
                deactivated_ids = active_in_subtree;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    let formula = get_rsip_formula_json(conn, id)?;
    Ok(serde_json::json!({
        "formula": formula,
        "old_parent_id": source.old_parent_id,
        "new_parent_id": new_parent_id,
        "deactivated_ids": deactivated_ids,
    }))
}

#[tauri::command]
fn move_rsip_formula(
    state: tauri::State<'_, Database>,
    id: i64,
    new_parent_id: Option<i64>,
    new_position: Option<i64>,
    allow_status_rollback: bool,
) -> Result<serde_json::Value, String> {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    move_rsip_formula_core(&mut conn, id, new_parent_id, new_position, allow_status_rollback)
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

fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|c| c > 0)
    .unwrap_or(false)
}

fn validate_backup_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("备份文件不存在".into());
    }

    let file_size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if file_size_bytes < 4096 {
        return Err(format!(
            "备份文件大小异常 ({} bytes)，文件可能已损坏。",
            file_size_bytes
        ));
    }

    let test_conn =
        Connection::open(path).map_err(|_| "选择的文件不是有效的 SQLite 数据库".to_string())?;

    // 关闭 WAL 模式，确保读取主文件内容
    let _ = test_conn.execute_batch("PRAGMA journal_mode=DELETE;");

    let mut missing: Vec<String> = Vec::new();
    for table in REQUIRED_TABLES {
        if !table_exists(&test_conn, table) {
            missing.push((*table).to_string());
        }
    }
    if !missing.is_empty() {
        return Err(format!(
            "备份文件缺少必要的表: {}\n该文件可能不是有效的 Protocol 数据库备份。",
            missing.join(", ")
        ));
    }

    Ok(())
}

#[tauri::command]
fn inspect_backup_file(backup_path: String) -> Result<serde_json::Value, String> {
    let path = Path::new(&backup_path);
    if !path.exists() {
        return Err("备份文件不存在".into());
    }

    let file_size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    // 文件太小（小于 4KB）说明可能是空文件或损坏的备份
    if file_size_bytes < 4096 {
        return Err(format!(
            "备份文件大小异常 ({} bytes)，该文件可能已损坏，请使用其他备份文件。",
            file_size_bytes
        ));
    }

    let conn =
        Connection::open(path).map_err(|_| "选择的文件不是有效的 SQLite 数据库".to_string())?;

    // 关闭 WAL 模式，确保读取的是主文件内容（处理旧版 fs::copy 备份的兼容问题）
    let _ = conn.execute_batch("PRAGMA journal_mode=DELETE;");

    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    // 额外检查：sqlite_master 中有多少张用户表
    let total_user_tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let mut table_info = serde_json::Map::new();
    for table in REQUIRED_TABLES.iter().chain(RSIP_TABLES.iter()) {
        if table_exists(&conn, table) {
            let count: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {}", table),
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            table_info.insert(table.to_string(), serde_json::json!(count));
        } else {
            table_info.insert(
                table.to_string(),
                serde_json::Value::String("(表不存在)".into()),
            );
        }
    }

    Ok(serde_json::json!({
        "path": backup_path,
        "file_size_bytes": file_size_bytes,
        "version": version,
        "tables": table_info,
        "total_user_tables": total_user_tables,
    }))
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
    let backup = Path::new(&backup_path);
    validate_backup_file(backup)?;

    // Safety backup before restore — 使用 VACUUM INTO 确保完整备份
    let safety_dir = state
        .db_path
        .parent()
        .unwrap_or(Path::new("."))
        .join(".backup");
    fs::create_dir_all(&safety_dir).map_err(|e| format!("无法创建安全备份目录: {}", e))?;
    let timestamp = chrono::Local::now().format("%Y-%m-%d-%H%M");
    let safety_path = safety_dir.join(format!("pre-restore-{}.sqlite", timestamp));
    let safety_path_str = safety_path.to_string_lossy().to_string();

    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("安全备份失败(WAL checkpoint): {}", e))?;
        let escaped = safety_path_str.replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
            .map_err(|e| format!("无法创建恢复前安全备份: {}", e))?;
    }

    // Release the database connection lock before replacing the file
    {
        let _guard = state.conn.lock().map_err(|e| e.to_string())?;
        // guard dropped immediately
    }

    // Replace database file
    fs::copy(backup, &state.db_path).map_err(|e| format!("恢复失败: {}", e))?;

    Ok(format!(
        "恢复成功，请重启 Protocol 以加载新数据。\n恢复前安全备份: {}",
        safety_path.display()
    ))
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
            move_rsip_formula,
            get_formula_events,
            get_rsip_formula_review,
            get_rsip_summary,
            get_protocol_timeline,
            get_app_settings,
            update_app_setting,
            backup_database,
            restore_database,
            inspect_backup_file,
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

    fn move_formula_test_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
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

            INSERT INTO rsip_formulas (id, parent_id, title, position, status) VALUES
                (2, NULL, 'Two', 0, 'active'),
                (7, NULL, 'Seven', 1, 'active'),
                (8, 7, 'Eight', 0, 'inactive'),
                (9, 8, 'Nine', 0, 'inactive'),
                (11, NULL, 'Eleven', 2, 'active');
            ",
        )
        .unwrap();
        conn
    }

    fn snapshot_tree(conn: &rusqlite::Connection) -> Vec<(i64, Option<i64>, i64, String)> {
        let mut stmt = conn
            .prepare("SELECT id, parent_id, position, status FROM rsip_formulas ORDER BY id")
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .unwrap();
        rows.map(|row| row.unwrap()).collect()
    }

    fn formula_json_fields(value: &serde_json::Value) -> (Option<i64>, Option<i64>, i64) {
        (
            value["formula"]["parent_id"].as_i64(),
            value["old_parent_id"].as_i64(),
            value["formula"]["position"].as_i64().unwrap(),
        )
    }

    #[test]
    fn move_rsip_formula_root_under_another_root() {
        let mut conn = move_formula_test_conn();
        let result = move_rsip_formula_core(&mut conn, 11, Some(7), None, false).unwrap();
        let (parent, old_parent, position) = formula_json_fields(&result);
        assert_eq!(parent, Some(7));
        assert_eq!(old_parent, None);
        assert_eq!(position, 1);
    }

    #[test]
    fn move_rsip_formula_promotes_child_to_root() {
        let mut conn = move_formula_test_conn();
        let result = move_rsip_formula_core(&mut conn, 8, None, None, false).unwrap();
        let (parent, old_parent, position) = formula_json_fields(&result);
        assert_eq!(parent, None);
        assert_eq!(old_parent, Some(7));
        assert_eq!(position, 3);
    }

    #[test]
    fn move_rsip_formula_rejects_self() {
        let mut conn = move_formula_test_conn();
        let err = move_rsip_formula_core(&mut conn, 7, Some(7), None, false).unwrap_err();
        assert!(err.contains("自身"), "got: {err}");
    }

    #[test]
    fn move_rsip_formula_rejects_descendants() {
        let mut conn = move_formula_test_conn();
        let err = move_rsip_formula_core(&mut conn, 7, Some(8), None, false).unwrap_err();
        assert!(err.contains("子孙"), "got: {err}");
        let err = move_rsip_formula_core(&mut conn, 7, Some(9), None, false).unwrap_err();
        assert!(err.contains("子孙"), "got: {err}");
    }

    #[test]
    fn move_rsip_formula_rejects_missing_target() {
        let mut conn = move_formula_test_conn();
        let err = move_rsip_formula_core(&mut conn, 7, Some(999), None, false).unwrap_err();
        assert!(err.contains("不存在"), "got: {err}");
    }

    #[test]
    fn move_rsip_formula_keeps_sibling_positions_contiguous() {
        let mut conn = move_formula_test_conn();
        move_rsip_formula_core(&mut conn, 11, Some(7), None, false).unwrap();

        let root_positions: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT position FROM rsip_formulas WHERE parent_id IS NULL ORDER BY position")
                .unwrap();
            let rows = stmt
                .query_map([], |row| row.get::<_, i64>(0))
                .unwrap();
            rows.map(|row| row.unwrap()).collect()
        };
        assert_eq!(root_positions, vec![0, 1]);

        let child_positions: Vec<i64> = {
            let mut stmt = conn
                .prepare("SELECT position FROM rsip_formulas WHERE parent_id = 7 ORDER BY position")
                .unwrap();
            let rows = stmt
                .query_map([], |row| row.get::<_, i64>(0))
                .unwrap();
            rows.map(|row| row.unwrap()).collect()
        };
        assert_eq!(child_positions, vec![0, 1]);
    }

    #[test]
    fn move_rsip_formula_to_inactive_parent_requires_rollback_confirm() {
        let mut conn = move_formula_test_conn();
        // 11 已点亮，8 未点亮：未确认则拒绝
        let err = move_rsip_formula_core(&mut conn, 11, Some(8), None, false).unwrap_err();
        assert!(err.contains("尚未点亮"), "got: {err}");
        // 确认后移动并递归熄灭
        let result = move_rsip_formula_core(&mut conn, 11, Some(8), None, true).unwrap();
        assert_eq!(result["deactivated_ids"], serde_json::json!([11]));
        assert_eq!(result["formula"]["status"].as_str(), Some("inactive"));
    }

    #[test]
    fn move_rsip_formula_to_active_parent_keeps_status() {
        let mut conn = move_formula_test_conn();
        let result = move_rsip_formula_core(&mut conn, 2, Some(7), None, false).unwrap();
        assert_eq!(result["formula"]["status"].as_str(), Some("active"));
        assert_eq!(result["deactivated_ids"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn move_rsip_formula_failure_leaves_no_partial_changes() {
        let mut conn = move_formula_test_conn();
        let before = snapshot_tree(&conn);
        // 三类失败：子孙、自身、目标不存在
        assert!(move_rsip_formula_core(&mut conn, 7, Some(8), None, false).is_err());
        assert!(move_rsip_formula_core(&mut conn, 7, Some(7), None, false).is_err());
        assert!(move_rsip_formula_core(&mut conn, 7, Some(999), None, false).is_err());
        assert!(move_rsip_formula_core(&mut conn, 7, Some(7), Some(0), false).is_err());
        let after = snapshot_tree(&conn);
        assert_eq!(before, after, "failed moves must not mutate the tree");
    }

    #[test]
    fn move_rsip_formula_persists_after_reopen() {
        let dir = std::env::temp_dir().join(format!("protocol_move_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("move_test.db");
        let _ = std::fs::remove_file(&path);
        {
            let mut conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE rsip_formulas (
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
                INSERT INTO rsip_formulas (id, parent_id, title, position) VALUES
                    (2, NULL, 'Two', 0),
                    (7, NULL, 'Seven', 1),
                    (8, 7, 'Eight', 0),
                    (11, NULL, 'Eleven', 2);",
            )
            .unwrap();
            move_rsip_formula_core(&mut conn, 11, Some(7), None, false).unwrap();
        }
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            let parent: Option<i64> = conn
                .query_row("SELECT parent_id FROM rsip_formulas WHERE id = 11", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(parent, Some(7));
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir_all(&dir);
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
