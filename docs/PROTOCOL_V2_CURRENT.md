# Protocol V2 Current

## Current Version

Protocol is now in V2 Gamma implementation.

V2 Alpha has been accepted as the current baseline:
- CTDP V1 is complete.
- Main chains, focus sessions, reservations, precedent creation, Dashboard, and History are usable.
- RSIP formula tree is connected to Dashboard and History.
- The application is no longer an empty shell or a V1-only prototype.

## V2 Gamma Focus

V2 Gamma strengthens the auxiliary-chain and RSIP review layers built on the V2 Beta adjudication baseline.

Current development priority:
- Preserve V2 Beta ruling semantics.
- Track independent auxiliary-chain current and best length.
- Treat auxiliary-chain fulfillment as continuity and automatic failure as auxiliary-chain breakage.
- Add a second reservation signal through a 3-minute confirmation window.
- Keep Dashboard, Chain Detail, Chain List, History, and the global button aligned around the new auxiliary-chain state.
- Make RSIP review useful at the single-formula level.

## Current Data Mapping

The sacred seat is not an independent table or API. In V2 Beta it is the product name for an active main-chain `focus_sessions` record. Starting the main chain snapshots the chain's trigger action and completion condition into that focus session.

The auxiliary chain is also not a new table. It is the product name for the existing `reservation_sessions` flow, now configured inside each main chain. Starting the auxiliary chain uses the main chain's auxiliary trigger action, delay, completion condition, and confirmation window, then either fulfills into a focus session or fails after the confirmation deadline.

Auxiliary-chain continuity is stored on `chains` through `auxiliary_current_length` and `auxiliary_best_length`. A fulfilled reservation increments the auxiliary length. An automatic auxiliary failure resets auxiliary length without changing the main-chain length.

Failure debugging is lightweight. Focus sessions and reservation sessions store `debug_category` and `debug_note` for review, but the app does not automatically rewrite the user's protocol.

## Product Position

Protocol should remain a restrained desktop protocol tool. It should not become a generic to-do app, a normal pomodoro timer, or a motivational gamification product.

RSIP continues as the long-term stable-state module. V2 Gamma adds single-formula review so a user can inspect lifecycle, deactivation notes, rollback impact, and event history without turning RSIP into a graph-heavy module.
