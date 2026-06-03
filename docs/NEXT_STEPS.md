# Protocol Next Steps

## Current Priority: V2 Beta

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

## Current Priority: V2 Gamma

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
- Auxiliary-chain failure after the confirmation window resets auxiliary length to zero while leaving main-chain length unchanged.
- Reservation sessions store `confirmation_due_at`.
- Reservation due time enters a confirmation state before automatic failure.
- Dashboard and the global button distinguish auxiliary countdown from auxiliary confirmation.
- Chain Detail shows auxiliary current and best length.
- RSIP has a single-formula review panel with lifecycle, latest deactivation note, rollback impact, and event history.
- `npm.cmd run build`, `cargo test reservation`, and `cargo check` pass.

Out of scope for V2 Beta:
- Large UI framework changes.
- Graph visualization libraries.
- Medical diagnosis or treatment claims.
- Rewriting the completed V1 / V2 Alpha flows.

