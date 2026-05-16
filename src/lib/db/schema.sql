-- Protocol Database Schema
-- This file documents the schema initialized in src-tauri/src/db.rs

CREATE TABLE IF NOT EXISTS chains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    focus_duration_minutes INTEGER NOT NULL DEFAULT 25,
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

-- Default settings
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_focus_duration', '25');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_reservation_duration', '15');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('enable_notifications', 'false');
