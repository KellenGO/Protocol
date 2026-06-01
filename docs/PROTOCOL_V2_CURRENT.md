# Protocol V2 Current

## Current Version

Protocol is now in V2 Beta implementation.

V2 Alpha has been accepted as the current baseline:
- CTDP V1 is complete.
- Main chains, focus sessions, reservations, precedent creation, Dashboard, and History are usable.
- RSIP formula tree is connected to Dashboard and History.
- The application is no longer an empty shell or a V1-only prototype.

## V2 Beta Focus

V2 Beta strengthens the precedent and ruling system, and upgrades each main chain into an explicit protocol configuration.

Current development priority:
- Make the sacred-seat marker obvious on Chain Detail as the visible CTDP trigger label.
- Store each main chain's trigger action, duration, and completion condition.
- Treat the old reservation flow as an embedded auxiliary chain configured on the main chain.
- Make protocol boundaries visible through the combined main-chain and auxiliary-chain precedent library.
- Turn focus failure into a formal main-chain ruling.
- Turn auxiliary-chain non-fulfillment into a formal auxiliary-chain ruling.
- Keep ruling input lightweight: choose one dispute behavior type, then decide violation or precedent.
- Keep pending ruling state synchronized across task pages, Dashboard, and the global button.
- Make History read like a protocol review timeline instead of a technical log.

## Current Data Mapping

The sacred seat is not an independent table or API. In V2 Beta it is the product name for an active main-chain `focus_sessions` record. Starting the main chain snapshots the chain's trigger action and completion condition into that focus session.

The auxiliary chain is also not a new table. It is the product name for the existing `reservation_sessions` flow, now configured inside each main chain. Starting the auxiliary chain uses the main chain's auxiliary trigger action, delay, and completion condition, then either fulfills into a focus session or enters auxiliary-chain ruling.

Failure debugging is lightweight. Focus sessions and reservation sessions store `debug_category` and `debug_note` for review, but the app does not automatically rewrite the user's protocol.

## Product Position

Protocol should remain a restrained desktop protocol tool. It should not become a generic to-do app, a normal pomodoro timer, or a motivational gamification product.

RSIP continues as the long-term stable-state module. CTDP V2 Beta focuses on adjudication quality: when a boundary is disputed, the user must either accept chain breakage / auxiliary-chain breach or formalize a precedent.
