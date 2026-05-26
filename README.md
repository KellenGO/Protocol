# Protocol

Protocol is an offline-first desktop app for turning self-control rules into explicit, reviewable protocols.

It combines two product ideas:

- **CTDP, Chain Time-Delay Protocol**: a main-chain and reservation-chain workflow for starting focus sessions, ruling failures, and preserving strict protocol boundaries.
- **RSIP, Recursive Stable Iteration Protocol**: a formula tree for longer-term stability rules, including activation, deactivation, event history, and rollback.

The current release is **V2 Beta**. CTDP V1 and RSIP V2 Alpha are already in place; this version strengthens the adjudication flow around failure, precedent, and protocol history.

## Current Release

**Version:** `v0.2.0-beta.1`

V2 Beta focuses on making "failure -> ruling -> violation / precedent -> history review" clear and lightweight.

Highlights:

- Main-chain rulings now enter a pending-ruling state instead of continuing the global countdown.
- Reservation breach rulings also synchronize with the global active-session button.
- Ruling forms were simplified to a single behavior type plus two explicit outcomes.
- Heavy precedent fields were removed from active business logic.
- Existing precedent rows keep their core data through a compatible SQLite migration.
- History uses protocol-language review text for CTDP and RSIP events.
- V2 docs were reorganized around the current V2 Beta direction.

## Features

### CTDP

- Create and manage main chains.
- Start formal focus sessions from a chain.
- Complete sessions and extend chain length.
- Enter formal ruling when a session fails.
- Judge a failure as a violation, causing the chain to break.
- Convert a disputed behavior into a precedent, preserving the chain boundary.
- Create reservation sessions and fulfill them into formal focus sessions.
- Judge reservation breaches or convert them into reservation precedents.
- Review protocol history across main-chain, reservation, and precedent events.

### RSIP

- Create root formulas and child formulas.
- Activate and deactivate formulas.
- Recursively roll back active child formulas when a parent formula is deactivated.
- Record RSIP events in the unified History view.
- Surface RSIP summary data on Dashboard.

### Desktop App

- Tauri 2 desktop shell.
- React + TypeScript frontend.
- Local SQLite storage.
- No cloud dependency.
- No account system.
- No third-party UI framework.

## Project Status

Protocol is not a generic Pomodoro timer, to-do list, habit streak app, or gamified productivity tool.

The current development line is:

- **Completed:** CTDP V1 minimum daily-use loop.
- **Completed:** V2 Alpha RSIP formula tree.
- **Current:** V2 Beta lightweight rulings and protocol boundaries.
- **Next:** V2 Gamma reservation-chain enhancement, second reservation signal, RSIP review improvements, UI consistency, and packaging.

See the docs for more detail:

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)
- [`docs/PROTOCOL_V2_CURRENT.md`](docs/PROTOCOL_V2_CURRENT.md)
- [`docs/PROTOCOL_V2_BETA_REPORT.md`](docs/PROTOCOL_V2_BETA_REPORT.md)
- [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md)

Historical planning docs are kept under [`docs/archive`](docs/archive).

## Development

### Requirements

- Node.js and npm
- Rust toolchain
- Microsoft Visual C++ Build Tools on Windows

### Install

```bash
npm install
```

### Run frontend only

```bash
npm run dev
```

### Run desktop app

```bash
npm run tauri dev
```

### Build frontend

```bash
npm run build
```

### Check Rust side

```bash
cd src-tauri
cargo check
```

### Build desktop package

```bash
npm run tauri build
```

## Repository Layout

```text
src/
  components/        Shared React components
  lib/db/            Frontend command wrappers
  pages/             App screens
  styles/            Global CSS
  types/             TypeScript types
src-tauri/
  src/               Rust commands, database setup, app entry
  tauri.conf.json    Desktop app configuration
docs/
  archive/           Historical planning documents
```

## Release Notes

This repository currently publishes early Windows desktop builds. The app stores data locally through SQLite and should be treated as an alpha/beta personal tool rather than production software.

