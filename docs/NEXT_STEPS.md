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

## Next Phase: V2 Gamma

After V2 Beta, move to V2 Gamma:
- Add independent reservation-chain length.
- Add second reservation signal / stronger due-time handling.
- Improve RSIP review and retrospective views.
- Continue UI wording unification around protocol language.
- Prepare packaging and release checks.

Out of scope for V2 Beta:
- Large UI framework changes.
- Graph visualization libraries.
- Medical diagnosis or treatment claims.
- Rewriting the completed V1 / V2 Alpha flows.

