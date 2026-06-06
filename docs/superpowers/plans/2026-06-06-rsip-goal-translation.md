# RSIP Goal Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual RSIP goal translation flow that connects goals, failure paths, intervention points, and concrete RSIP formulas without rewriting the existing formula tree.

**Architecture:** Extend the existing SQLite/Rust/Tauri command layer compatibly, then expose the new records through TypeScript wrappers and a restrained RSIP page goal view/wizard. Existing RSIP formula tree commands remain the default formula source; goal-linked formulas are additional metadata on the same `rsip_formulas` rows.

**Tech Stack:** Tauri 2, Rust, rusqlite, SQLite, React 19, TypeScript, plain CSS, npm.cmd, cargo.

---

## File Structure

- Modify `src-tauri/src/db.rs`: create goal/failure-path tables and add nullable formula columns through repeatable migrations.
- Modify `src-tauri/src/lib.rs`: add RSIP goal helper functions, JSON row serializers, commands, command registration, database info/export awareness, and Rust tests.
- Modify `src/lib/db/schema.sql`: document the new tables and formula columns.
- Modify `src/types/index.ts`: add `RsipGoal`, `RsipFailurePath`, `FailurePathNode`, `GoalFormulaDraft`, and formula metadata fields.
- Modify `src/lib/db/index.ts`: add Tauri invoke wrappers.
- Modify `src/pages/RSIP.tsx`: add view state, goal loading, goal cards, four-step wizard, and goal-linked formula creation while preserving existing formula-tree UI.
- Modify `src/styles/global.css`: add goal view and wizard styles using existing Protocol visual tokens.
- Add `docs/RSIP_GOAL_TRANSLATION_REPORT.md`: implementation report.
- Modify `docs/NEXT_STEPS.md`, `docs/PROTOCOL_V2_CURRENT.md`, and `CHANGELOG.md`: v0.4 status updates.

---

### Task 1: Schema and Helper Tests

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/db/schema.sql`

- [ ] **Step 1: Write failing Rust tests for goal translation helpers**

Add tests in `src-tauri/src/lib.rs` under the existing `#[cfg(test)] mod tests`:

```rust
#[test]
fn rsip_goal_input_rejects_empty_title() {
    assert!(clean_rsip_goal_input("  ", "sleep earlier").is_err());
}

#[test]
fn rsip_goal_input_trims_title_and_description() {
    let cleaned = clean_rsip_goal_input("  Sleep earlier  ", "  Reduce bedtime drift  ").unwrap();
    assert_eq!(cleaned, ("Sleep earlier".to_string(), "Reduce bedtime drift".to_string()));
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
        clean_goal_formula_dependency(Some(1), Some("  parent failure destabilizes this  ".to_string())).unwrap(),
        Some("parent failure destabilizes this".to_string())
    );
    assert_eq!(clean_goal_formula_dependency(None, None).unwrap(), None);
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
cd src-tauri
cargo test rsip_goal_input
cargo test failure_path_nodes_json
cargo test child_formula_requires_dependency_note
```

Expected: FAIL because `clean_rsip_goal_input`, `failure_path_nodes_json`, and `clean_goal_formula_dependency` do not exist yet.

- [ ] **Step 3: Implement helper functions**

Add near existing RSIP helpers in `src-tauri/src/lib.rs`:

```rust
fn clean_rsip_goal_input(title: &str, description: &str) -> Result<(String, String), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("目标名称不能为空".into());
    }
    Ok((title, description.trim().to_string()))
}

fn failure_path_nodes_json(nodes: Vec<String>) -> Result<String, String> {
    let nodes: Vec<serde_json::Value> = nodes
        .into_iter()
        .map(|node| node.trim().to_string())
        .filter(|node| !node.is_empty())
        .enumerate()
        .map(|(index, text)| serde_json::json!({
            "id": format!("node-{}", index + 1),
            "text": text,
        }))
        .collect();

    if nodes.is_empty() {
        return Err("失败路径至少需要一个行为节点".into());
    }

    serde_json::to_string(&nodes).map_err(|e| e.to_string())
}

fn clean_goal_formula_dependency(
    parent_id: Option<i64>,
    dependency_note: Option<String>,
) -> Result<Option<String>, String> {
    let cleaned = dependency_note.unwrap_or_default().trim().to_string();
    if parent_id.is_some() && cleaned.is_empty() {
        return Err("创建子定式时需要说明它为什么依赖父定式".into());
    }
    if cleaned.is_empty() {
        Ok(None)
    } else {
        Ok(Some(cleaned))
    }
}
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run:

```powershell
cd src-tauri
cargo test rsip_goal_input
cargo test failure_path_nodes_json
cargo test child_formula_requires_dependency_note
```

Expected: PASS for the new helper tests.

- [ ] **Step 5: Add compatible schema migrations**

In `src-tauri/src/db.rs`, add `CREATE TABLE IF NOT EXISTS rsip_goals` and `CREATE TABLE IF NOT EXISTS rsip_failure_paths` to `initialize_schema`, then add a `migrate_rsip_goal_translation_schema(&conn)?;` call after existing migrations. Implement:

```rust
fn migrate_rsip_goal_translation_schema(conn: &Connection) -> SqliteResult<()> {
    add_column_if_missing(conn, "rsip_formulas", "goal_id", "INTEGER")?;
    add_column_if_missing(conn, "rsip_formulas", "failure_path_id", "INTEGER")?;
    add_column_if_missing(conn, "rsip_formulas", "intervention_node_id", "TEXT")?;
    add_column_if_missing(conn, "rsip_formulas", "dependency_note", "TEXT")?;
    Ok(())
}
```

Update `src/lib/db/schema.sql` with the same table definitions and nullable formula fields.

- [ ] **Step 6: Run schema-related Rust check**

Run: `cd src-tauri; cargo check`

Expected: PASS.

---

### Task 2: Rust Commands and Query Tests

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests for goal-linked formula storage**

Add test:

```rust
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
```

- [ ] **Step 2: Run query test to verify RED**

Run: `cd src-tauri; cargo test goal_formula_rows_are_queryable_by_goal`

Expected: FAIL because helper record functions and extended formula JSON fields do not exist.

- [ ] **Step 3: Extend formula JSON fields**

Change `RSIP_FORMULA_FIELDS` to include:

```rust
goal_id, failure_path_id, intervention_node_id, dependency_note
```

Extend `rsip_formula_json` with:

```rust
"goal_id": row.get::<_, Option<i64>>(10)?,
"failure_path_id": row.get::<_, Option<i64>>(11)?,
"intervention_node_id": row.get::<_, Option<String>>(12)?,
"dependency_note": row.get::<_, Option<String>>(13)?,
```

- [ ] **Step 4: Implement goal/failure-path serializers and record helpers**

Add `rsip_goal_json`, `rsip_failure_path_json`, `insert_rsip_goal_record`, `insert_failure_path_record`, `insert_goal_formula_record`, and `get_goal_formula_records` as connection-based helpers. Use these SQL shapes:

```sql
INSERT INTO rsip_goals (title, description) VALUES (?1, ?2)
INSERT INTO rsip_failure_paths (goal_id, title, nodes_json) VALUES (?1, ?2, ?3)
INSERT INTO rsip_formulas (
  parent_id, title, description, position, goal_id, failure_path_id, intervention_node_id, dependency_note
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
SELECT <RSIP_FORMULA_FIELDS> FROM rsip_formulas WHERE goal_id = ?1 ORDER BY COALESCE(parent_id, 0), position, created_at
```

- [ ] **Step 5: Add Tauri commands**

Implement:

```rust
create_rsip_goal
get_rsip_goals
update_rsip_goal
archive_rsip_goal
create_failure_path
get_failure_paths
create_formula_from_goal
get_formulas_by_goal
```

Register them in `tauri::generate_handler![...]`.

- [ ] **Step 6: Update database info and export awareness**

Include `rsip_goals` and `rsip_failure_paths` counts in `get_database_info`. Include both tables in `export_history_json`.

- [ ] **Step 7: Add in-memory test connection**

Add `rsip_goal_test_conn()` creating `rsip_goals`, `rsip_failure_paths`, `rsip_formulas`, and `formula_events` with the new fields.

- [ ] **Step 8: Run query test to verify GREEN**

Run: `cd src-tauri; cargo test goal_formula_rows_are_queryable_by_goal`

Expected: PASS.

---

### Task 3: TypeScript Types and DB Wrappers

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/db/index.ts`

- [ ] **Step 1: Extend TypeScript types**

Add:

```ts
export interface FailurePathNode {
  id: string;
  text: string;
}

export interface RsipGoal {
  id: number;
  title: string;
  description: string | null;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  formula_count: number;
  failure_path_count: number;
}

export interface RsipFailurePath {
  id: number;
  goal_id: number;
  title: string;
  nodes_json: string;
  created_at: string;
  updated_at: string;
}

export interface GoalFormulaDraft {
  goalId: number;
  failurePathId: number;
  interventionNodeId: string;
  title: string;
  description: string;
  parentId?: number | null;
  dependencyNote?: string | null;
}
```

Extend `RsipFormula` with nullable goal fields.

- [ ] **Step 2: Add invoke wrappers**

Add in `src/lib/db/index.ts`:

```ts
export async function createRsipGoal(params: { title: string; description: string }): Promise<RsipGoal>
export async function getRsipGoals(includeArchived = false): Promise<RsipGoal[]>
export async function updateRsipGoal(id: number, params: { title: string; description: string; status?: 'active' | 'archived' }): Promise<RsipGoal>
export async function archiveRsipGoal(id: number): Promise<RsipGoal>
export async function createFailurePath(params: { goalId: number; title: string; nodes: string[] }): Promise<RsipFailurePath>
export async function getFailurePaths(goalId: number): Promise<RsipFailurePath[]>
export async function createFormulaFromGoal(params: GoalFormulaDraft): Promise<RsipFormula>
export async function getFormulasByGoal(goalId: number): Promise<RsipFormula[]>
```

- [ ] **Step 3: Run typecheck**

Run: `npm.cmd run typecheck`

Expected: PASS once frontend code still compiles against extended types.

---

### Task 4: RSIP Goal View and Translation Wizard

**Files:**
- Modify: `src/pages/RSIP.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add imports and state**

Import new DB wrappers and types. Add state for:

```ts
const [viewMode, setViewMode] = useState<'tree' | 'goals'>('tree');
const [goals, setGoals] = useState<RsipGoal[]>([]);
const [goalPaths, setGoalPaths] = useState<RsipFailurePath[]>([]);
const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null);
const [wizardOpen, setWizardOpen] = useState(false);
```

- [ ] **Step 2: Load goal data with existing RSIP reload**

Extend `reload()` to call `getRsipGoals(false)` and populate goal state.

- [ ] **Step 3: Add header controls**

Render compact buttons for `新建目标转译` and `查看目标`, plus a two-option segmented control for formula tree/goals.

- [ ] **Step 4: Add goal view cards**

Create a `GoalListView` component in the same file. It shows active goals with formula count, failure-path count, and buttons for view, continue translation, and archive.

- [ ] **Step 5: Add four-step wizard component**

Create `GoalTranslationWizard` in the same file. It should:

- Step 1 collect goal title and description.
- Step 2 collect multiline failure path nodes.
- Step 3 select one node.
- Step 4 collect formula title, formula description, optional parent formula, and dependency note.
- Call `createRsipGoal`, `createFailurePath`, and `createFormulaFromGoal`.
- Close, reset state, reload, switch to formula tree, and review the created formula.

- [ ] **Step 6: Keep child dependency guidance visible**

If parent formula is selected, show copy equivalent to: if the parent formula fails, would this child formula also probably become unstable? If yes, it fits as a child; if not, create it as another root formula under the same goal.

- [ ] **Step 7: Add CSS**

Add CSS classes:

```css
.rsip-header-actions
.rsip-view-toggle
.rsip-goal-grid
.rsip-goal-card
.goal-wizard
.goal-wizard-steps
.failure-node-list
.intervention-option
.dependency-guidance
```

Use existing `var(--bg-card)`, `var(--border-subtle)`, `var(--radius)`, `btn`, `form-field`, and responsive grid patterns.

- [ ] **Step 8: Run typecheck**

Run: `npm.cmd run typecheck`

Expected: PASS.

---

### Task 5: Documentation and Full Validation

**Files:**
- Add: `docs/RSIP_GOAL_TRANSLATION_REPORT.md`
- Modify: `docs/NEXT_STEPS.md`
- Modify: `docs/PROTOCOL_V2_CURRENT.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add implementation report**

Create `docs/RSIP_GOAL_TRANSLATION_REPORT.md` covering:

- Added goal translation features.
- New tables and formula fields.
- Goal to failure path to intervention point to formula relationship.
- Parent-child dependency rule.
- Why one goal can have multiple parallel root formula trees.
- Explicitly excluded AI suggestions, cloud sync, accounts, mobile, and major UI framework changes.

- [ ] **Step 2: Update product docs**

Update docs and changelog to describe Protocol v0.4 RSIP goal translation as the current added slice while preserving v0.3/v0.3.x baseline language.

- [ ] **Step 3: Run final validation**

Run all:

```powershell
npm.cmd run check
npm.cmd run build
cd src-tauri
cargo check
cargo test
```

Expected: all commands exit 0. If any command fails, fix and rerun that command before reporting.

- [ ] **Step 4: Review final diff**

Run:

```powershell
git status --short
git diff --stat
git diff -- src-tauri/src/db.rs src-tauri/src/lib.rs src/lib/db/index.ts src/types/index.ts src/pages/RSIP.tsx src/styles/global.css
```

Expected: changes are scoped to RSIP goal translation, docs, and the plan/spec artifacts.
