# Protocol V2 Current

## Current Version

Protocol is now in the post-V2-Gamma closure stage for auxiliary-chain adjudication, precedent-library maturity, and the first RSIP single-formula maintenance slice.

V2 Alpha has been accepted as the current baseline:
- CTDP V1 is complete.
- Main chains, focus sessions, reservations, precedent creation, Dashboard, and History are usable.
- RSIP formula tree is connected to Dashboard and History.
- The application is no longer an empty shell or a V1-only prototype.

## Current Focus

V2 Gamma strengthened the auxiliary-chain and RSIP review layers built on the V2 Beta adjudication baseline. The current focus is closing the remaining CTDP / auxiliary-chain / precedent-library loop while making RSIP single-formula review editable enough for real daily use in a complete offline desktop version.

Current development priority:
- Preserve V2 Beta ruling semantics.
- Keep independent auxiliary-chain current and best length.
- Treat auxiliary-chain fulfillment as continuity.
- Treat confirmation-window expiry as a pending auxiliary-chain ruling, not an automatic final failure.
- Let the user formally decide auxiliary-chain violation or auxiliary-chain precedent.
- Allow active precedents to be viewed, edited, and retired without deleting history.
- Let RSIP review update a formula's title and execution description.
- Let RSIP deactivation record a user-written note instead of relying only on a generic default.
- Keep Dashboard, Chain Detail, Chain List, History, and the global button aligned around active protocol state.

## Current Data Mapping

The sacred seat is not an independent table or API. In V2 Beta it is the product name for an active main-chain `focus_sessions` record. Starting the main chain snapshots the chain's trigger action and completion condition into that focus session.

The auxiliary chain is also not a new table. It is the product name for the existing `reservation_sessions` flow, now configured inside each main chain. Starting the auxiliary chain uses the main chain's auxiliary trigger action, delay, completion condition, and confirmation window, then either fulfills into a focus session or enters auxiliary-chain ruling after the confirmation deadline.

Auxiliary-chain continuity is stored on `chains` through `auxiliary_current_length` and `auxiliary_best_length`. A fulfilled reservation increments the auxiliary length. An auxiliary-chain violation ruling resets auxiliary length without changing the main-chain length. An auxiliary-chain precedent ruling preserves auxiliary length and adds a `reservation_chain` precedent.

The precedent library is the visible protocol boundary. Precedents can be active or retired. Retired precedents remain in historical records but are no longer shown as active protocol boundaries.

Failure debugging is lightweight. Focus sessions and reservation sessions store `debug_category` and `debug_note` for review, but the app does not automatically rewrite the user's protocol.

## Product Position

Protocol should remain a restrained desktop protocol tool. It should not become a generic to-do app, a normal pomodoro timer, or a motivational gamification product.

RSIP continues as the long-term stable-state module. V2 Gamma adds single-formula review so a user can inspect lifecycle, deactivation notes, rollback impact, and event history without turning RSIP into a graph-heavy module. The current maturity slice keeps that restrained shape and adds formula title/description editing plus custom deactivation notes.

The current product boundary is the complete offline desktop version. AI suggestions, cloud sync, accounts, mobile apps, and community features remain outside the active scope.
