# Protocol V2 Gamma Report

## Summary

V2 Gamma adds auxiliary-chain continuity, a two-stage reservation deadline, and RSIP single-formula review.

The core auxiliary-chain flow is now:

`reservation countdown -> confirmation window -> fulfillment / automatic failure`

## Implemented Functions

- Added independent auxiliary-chain length on each main chain.
- Added `confirmation_due_at` to reservation sessions.
- Added a default 3-minute auxiliary confirmation window setting.
- Made auxiliary fulfillment increment auxiliary chain length.
- Made auxiliary failure reset auxiliary chain length while preserving main-chain length.
- Updated Dashboard and the global button to distinguish countdown from confirmation.
- Added auxiliary current and best length to Chain Detail and Chain List.
- Added RSIP single-formula review with lifecycle, deactivation note, rollback impact, and event history.

## Auxiliary Chain Length

Auxiliary-chain length now tracks continuity of reservation fulfillment:

- Fulfillment before the confirmation deadline increments `auxiliary_current_length`.
- If current length exceeds best length, `auxiliary_best_length` is updated.
- Automatic failure after the confirmation deadline resets `auxiliary_current_length` to zero.
- Main-chain length is not changed by auxiliary-chain failure.

## Second Reservation Signal

The original reservation deadline is no longer the immediate failure point.

When `due_at` passes, the active reservation enters a confirmation state. The user can still enter the main chain during this window. If `confirmation_due_at` passes with no fulfillment, the reservation is automatically recorded as failed.

The default confirmation window is 3 minutes and is stored in `app_settings` as `auxiliary_confirmation_window_minutes`.

## RSIP Review

The RSIP page now supports reviewing one selected formula:

- Current formula status.
- Created, activated, and deactivated timestamps.
- Descendant formula count and active descendant count.
- Rollback impact count.
- Latest deactivation note.
- Recent formula events.

## Verification

- `cargo test reservation`: passed.
- `npm.cmd run build`: passed.
- `cargo check`: passed.

Note: Rust commands still print the existing non-blocking warning: `could not canonicalize path C:\Users\Kellen`.
