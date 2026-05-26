# Protocol V2 Beta Report

## Summary

This round keeps the V2 Beta adjudication direction, but simplifies the ruling flow back into a lightweight protocol decision.

The core flow is now:

`dispute -> choose behavior type -> violation / precedent -> protocol timeline review`

## Implemented Functions

- Fixed the global focus button state bug during pending rulings.
- Added a lightweight `pending_ruling` semantic state for active focus and reservation sessions.
- Simplified main-chain and reservation ruling pages.
- Removed the heavy ruling form from the UI and business logic.
- Kept the precedent library as the visible protocol boundary.
- Kept RSIP Dashboard and History integration intact.

## Global Button Bug

Cause:
- `GlobalFocusButton` was independently deriving UI state from `expected_end_at`.
- After the user entered a ruling page, the active focus session still had no final result, so the global button kept counting by time and eventually displayed "专注已完成".
- The real task page had already moved into a ruling phase, so global UI and page UI diverged.

Fix:
- Active focus and active reservation queries now return `pending_ruling: boolean`.
- Entering a main-chain or reservation ruling writes an internal pending marker into the existing session `failure_note`.
- Final rulings overwrite that marker with the lightweight behavior type.
- Returning from the ruling page clears the marker.
- `GlobalFocusButton` and Dashboard now read the real active session state instead of maintaining a separate ruling interpretation.

## Ruling Form Simplification

Removed from UI and business logic:
- `failure_reason`
- `ruling_note`
- `severity`
- `category`
- `created_from_context`

The database migration removes these fields from the `precedents` table and preserves only the original core precedent columns:
- `id`
- `chain_id`
- `scope`
- `title`
- `description`
- `created_from_session_id`
- `created_from_session_type`
- `created_at`

Existing precedent rows are preserved. Data in the removed enhancement fields is intentionally discarded because those features are no longer part of the product.

## New Behavior Type

The ruling page now asks for one lightweight field: "争议行为类型".

Options:
- 通讯 / 消息打断
- 手机 / 娱乐诱惑
- 外部事件
- 生理需求
- 环境变化
- 任务定义不清
- 身体状态不佳
- 紧急情况
- 其他

If "其他" is selected, the user enters a short custom behavior label.

This value is used as:
- The precedent title when the user chooses precedent creation.
- The session `failure_note` when the user chooses violation / reservation breach.
- The History / Timeline review label.

## Verification

- `npm.cmd run build`: passed.
- `cargo check`: passed.

Note: `cargo check` printed a non-blocking warning: `could not canonicalize path C:\Users\Kellen`; the check still finished successfully.

