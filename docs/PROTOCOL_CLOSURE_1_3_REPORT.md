# Protocol Closure 1-3 Report

## Summary

This closure finishes the first three remaining product areas for the current offline desktop track:

1. Documentation and product-position alignment.
2. Auxiliary-chain ruling closure.
3. Precedent-library maturity v1.

RSIP remains at the V2 Gamma single-formula review level. Full RSIP maturation is intentionally deferred.

## Documentation Alignment

The current product boundary is the complete offline desktop version. The active scope does not include AI suggestions, cloud sync, accounts, mobile apps, or community sharing.

The documentation now treats V2 Beta and V2 Gamma as completed baselines, with the current line focused on auxiliary-chain adjudication and precedent-library maturity.

## Auxiliary-Chain Ruling

Auxiliary-chain confirmation expiry now enters pending ruling instead of becoming final failure immediately.

The user must decide:

- Violation: write `reservation_sessions.failed_reset`, reset auxiliary-chain current length to zero, and leave main-chain length unchanged.
- Precedent: write `reservation_sessions.failed_precedent`, create a `reservation_chain` precedent, and preserve auxiliary-chain current length.

Dashboard, Chain Detail, History, and the global button use this pending-ruling state as part of the active protocol flow.

## Precedent Library V1

Precedents are now manageable protocol-boundary records:

- Active precedents appear in Chain Detail protocol boundaries.
- A precedent can be opened for detail review.
- Title and description can be edited.
- A precedent can be retired.
- Retired precedents remain in historical records but are hidden from active protocol boundaries.

This keeps precedent history intact while allowing the active protocol boundary to evolve.

## Verification

Required verification for this closure:

- `cargo test reservation`
- `npm.cmd run build`
- `npm.cmd run lint`
- `cargo check`
