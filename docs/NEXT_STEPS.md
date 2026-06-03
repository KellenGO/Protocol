# Protocol Next Steps

## Completed Baseline: V2 Beta

Priority for Codex / Claude Code:
- Preserve the V2 Alpha baseline.
- Do not rewrite CTDP V1 or V2 Alpha.
- Keep the ruling flow lightweight: behavior type -> violation / precedent.
- Keep pending ruling state synchronized across page UI, Dashboard, and the global button.
- Treat `docs/archive/V1_IMPLEMENTATION_PLAN.md` as historical reference only.

## V2 Beta Acceptance

V2 Beta is accepted when:
- Main-chain and reservation rulings no longer show long reason text, ruling note, severity, or category fields.
- The precedent enhancement fields are removed from active business logic and cleaned from the `precedents` table through a compatible migration.
- Existing precedent rows keep their core data.
- Entering a main-chain ruling makes the global button show pending ruling instead of "专注已完成".
- Entering a reservation breach ruling makes the global button show pending ruling.
- Chain Detail shows protocol boundaries using only title, description, time, and scope.
- History presents CTDP adjudication events using the selected behavior type.
- `npm.cmd run build` and `cargo check` pass.

## Completed Baseline: V2 Gamma

V2 Gamma focuses on auxiliary-chain continuity and RSIP retrospective review:
- Add independent auxiliary-chain length.
- Add a second reservation signal with a 3-minute confirmation window.
- Improve RSIP review with a single-formula retrospective panel.
- Continue UI wording unification around protocol language.
- Prepare packaging and release checks.

## V2 Gamma Acceptance

V2 Gamma is accepted when:
- Each chain stores `auxiliary_current_length` and `auxiliary_best_length`.
- Auxiliary-chain fulfillment increments auxiliary length and updates best length.
- Confirmation-window expiry enters auxiliary-chain ruling instead of silently finalizing failure.
- Reservation sessions store `confirmation_due_at`.
- Reservation due time enters a confirmation state before automatic failure.
- Dashboard and the global button distinguish auxiliary countdown from auxiliary confirmation.
- Chain Detail shows auxiliary current and best length.
- RSIP has a single-formula review panel with lifecycle, latest deactivation note, rollback impact, and event history.
- `npm.cmd run build`, `cargo test reservation`, and `cargo check` pass.

## Current Priority: Closure 1-4

Current development focuses on making the offline desktop version coherent enough for long-term personal use:

- Unify product documentation around the current post-Gamma state.
- Complete auxiliary-chain ruling: violation resets auxiliary-chain length; precedent preserves it and writes a `reservation_chain` precedent.
- Mature the precedent library with detail view, title/description editing, and retirement.
- Keep retired precedents in history while hiding them from active protocol boundaries.
- Add the first RSIP maturity slice: edit a formula's title/description from the review panel and record a user-written deactivation note.

## Closure 1-4 Acceptance

This closure is accepted when:

- README, product spec, current-state docs, and protocol mapping no longer describe the app as Beta-only or say auxiliary chains lack independent length.
- Auxiliary-chain confirmation expiry shows pending ruling in Chain Detail, Dashboard, and the global button.
- Auxiliary-chain ruling supports violation and precedent outcomes.
- Active precedent lists exclude retired precedents.
- A precedent can be opened from Chain Detail or a History precedent event, edited, and retired.
- RSIP review can update the selected formula's title and execution description.
- Deactivating the selected RSIP formula can store a custom note, with a default note only when the field is blank.
- `npm.cmd run build`, `npm.cmd run lint`, `cargo test reservation`, and `cargo check` pass.

Out of scope for the current closure:
- Large UI framework changes.
- Graph visualization libraries.
- RSIP formula groups, cycle reviews, batch management, and graph-heavy administration.
- Medical diagnosis or treatment claims.
- Rewriting the completed V1 / V2 Alpha flows.
- AI suggestions, cloud sync, accounts, mobile apps, and community sharing.

