# RSIP Goal Translation Design

## Purpose

Protocol v0.4 adds a manual RSIP goal translation system. The user can start from a broad goal, describe the usual failure path, choose an intervention point, and create a concrete RSIP formula connected back to that goal context.

This is not an AI suggestion feature, not a habit tracker, and not a rewrite of the existing RSIP formula tree. It extends the current offline desktop RSIP module with a compatible goal layer.

## Scope

In scope:

- Add `rsip_goals` and `rsip_failure_paths`.
- Add nullable goal/failure-path/intervention/dependency fields to `rsip_formulas`.
- Add Rust commands for creating, listing, updating, archiving, and querying goal-linked RSIP records.
- Add TypeScript types and DB wrapper functions.
- Add a restrained RSIP page goal view and four-step translation wizard.
- Preserve the existing formula tree, activation, deactivation, recursive rollback, review panel, History, Review, CTDP, auxiliary-chain, and data-management behavior.
- Update v0.4 documentation and validation report.

Out of scope:

- AI-generated suggestions.
- Cloud sync, accounts, mobile, or multi-device features.
- Large UI framework changes.
- CTDP or auxiliary-chain business logic changes.
- Rebuilding existing tables or deleting old fields.

## Product Model

A Goal is the user's broad direction, such as sleeping earlier or reducing phone scrolling. It is not a task and is not directly executable.

A Failure Path records the behavior sequence that usually defeats the goal. It stores ordered nodes as JSON text so the first version stays simple and compatible.

An Intervention Point is one selected node from that failure path. It marks where the user wants to insert a low-friction rule.

A Formula is the executable RSIP rule. The existing `rsip_formulas` table remains the source of formula tree behavior. Goal-linked formulas can still be root formulas or child formulas.

Parent-child formula structure means dependency, not topic similarity. When the user creates a child formula, the UI must ask whether the child would probably become unstable if the parent formula failed. If not, it should be created as another root formula under the same goal.

## Data Design

Create `rsip_goals`:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `title TEXT NOT NULL`
- `description TEXT`
- `status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived'))`
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `archived_at TEXT`

Create `rsip_failure_paths`:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `goal_id INTEGER NOT NULL`
- `title TEXT NOT NULL`
- `nodes_json TEXT NOT NULL`
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `FOREIGN KEY (goal_id) REFERENCES rsip_goals(id) ON DELETE CASCADE`

Extend `rsip_formulas` with nullable fields:

- `goal_id INTEGER`
- `failure_path_id INTEGER`
- `intervention_node_id TEXT`
- `dependency_note TEXT`

Schema initialization uses `CREATE TABLE IF NOT EXISTS` and `add_column_if_missing` so old data remains valid and migrations can run repeatedly. Existing formulas are allowed to keep `goal_id = NULL`.

## Backend Commands

Add commands:

- `create_rsip_goal(title, description)`
- `get_rsip_goals(includeArchived?)`
- `update_rsip_goal(id, title, description, status?)`
- `archive_rsip_goal(id)`
- `create_failure_path(goalId, title, nodes)`
- `get_failure_paths(goalId)`
- `create_formula_from_goal(goalId, failurePathId, interventionNodeId, title, description, parentId?, dependencyNote?)`
- `get_formulas_by_goal(goalId)`

Existing formula commands stay in place. `get_rsip_formulas` continues to return all formulas for the existing formula-tree view.

## Frontend Design

The RSIP page keeps the current formula-tree panel as the default view. A segmented control or compact tabs switch between:

- Formula tree
- Goals

The header adds two clear actions:

- New goal translation
- View goals

The goal view shows active goal cards with title, description, formula count, failure-path count, and actions for view, continue translation, and archive.

The translation wizard has four steps:

1. Goal input: title and optional description. Copy emphasizes that goals are directions, not executable formulas.
2. Failure path: multiline node input, one behavior node per line.
3. Intervention point: choose one node from the path.
4. Formula draft: title, execution description, optional parent formula, dependency note, and dependency guidance.

On completion, the wizard creates or reuses the goal, creates a failure path, creates a linked formula, reloads RSIP data, and shows the resulting formula in the current RSIP page.

## UI Style

Keep the Protocol desktop style calm, dense, and utilitarian. Use existing cards, buttons, status badges, form fields, and CSS variables. Avoid decorative hero layouts, large visual frameworks, and graph-heavy layouts.

Text should reinforce:

- Goals are directions; formulas are protocols.
- RSIP is stable-state debugging, not habit check-in.
- Smaller formulas are better.
- Child formulas require real dependency on the parent formula.
- A parent rollback is not punishment; it acknowledges an unstable dependency.
- One goal can have multiple parallel root formula trees.

## Testing

Rust unit tests should cover:

- Goal title trimming and required-title validation.
- Failure-path node JSON creation from ordered nodes.
- Child formula dependency-note validation when a parent is selected.
- Goal-linked formulas can be queried by goal.
- Existing formulas without `goal_id` remain valid.

TypeScript verification should cover type correctness through `npm.cmd run check`.

Final validation:

- `npm.cmd run check`
- `npm.cmd run build`
- `cargo check`
- `cargo test`

## Documentation

Add `docs/RSIP_GOAL_TRANSLATION_REPORT.md`.

Update:

- `docs/NEXT_STEPS.md`
- `docs/PROTOCOL_V2_CURRENT.md`
- `CHANGELOG.md`

The report should explain what was added, the new tables and fields, the goal-to-formula relationship, the parent-child dependency rule, why one goal can have multiple root formula trees, and what remains out of scope.
