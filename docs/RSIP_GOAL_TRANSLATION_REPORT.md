# RSIP Goal Translation Report

## Summary

Protocol v0.4 adds a manual RSIP goal translation layer. A user can now start from a broad goal, describe the failure path that usually defeats it, choose an intervention point, and generate a concrete RSIP formula tied back to that context.

This preserves the existing RSIP formula tree. Goal translation adds metadata and a guided creation path; it does not replace activation, deactivation, recursive rollback, single-formula review, History, CTDP, auxiliary-chain, or data-management flows.

## Added Functionality

- Active RSIP goals can be created, viewed, continued, and archived.
- Failure paths are recorded as ordered behavior nodes under a goal.
- A four-step RSIP page wizard translates goal -> failure path -> intervention point -> formula.
- Goal-linked formulas appear in the existing formula tree and can still be activated, deactivated, reviewed, and rolled back.
- The goal view shows how many formulas and failure paths belong to each active goal.
- Child formula creation now asks for a dependency note when the formula is created from a goal translation and attached to a parent formula.

## Data Changes

New `rsip_goals` table:

- `id`
- `title`
- `description`
- `status`
- `created_at`
- `updated_at`
- `archived_at`

New `rsip_failure_paths` table:

- `id`
- `goal_id`
- `title`
- `nodes_json`
- `created_at`
- `updated_at`

Compatible `rsip_formulas` columns:

- `goal_id`
- `failure_path_id`
- `intervention_node_id`
- `dependency_note`

Existing formula rows can keep these fields empty. The initializer uses `CREATE TABLE IF NOT EXISTS` and missing-column migration helpers, so existing databases are extended rather than rebuilt.

## Product Relationship

A goal is a direction, not an executable protocol. A failure path explains how the goal usually breaks down. An intervention point marks where the user wants to interrupt that path. A formula is the low-friction rule that can actually be executed.

The intended flow is:

`Goal -> Failure Path -> Intervention Point -> Formula`

## Dependency Rule

A child formula should represent dependency, not topical similarity. If the parent formula fails and the child formula would probably become unstable too, the child relationship is appropriate. If the rule is merely related to the same goal, it is better modeled as another root formula under that goal.

This is why one goal can have multiple parallel root formula trees. For example, a sleep goal can have one phone chain, one shutdown chain, and one bedroom-environment chain without forcing those unrelated rules into one artificial parent-child tree.

## Out of Scope

This release does not add:

- AI-generated suggestions.
- Cloud sync.
- Accounts.
- Mobile support.
- Social/community features.
- A large UI framework.
- CTDP or auxiliary-chain business-logic rewrites.

## Validation Targets

Required validation for this slice:

- `npm.cmd run check`
- `npm.cmd run build`
- `cargo check`
- `cargo test`
