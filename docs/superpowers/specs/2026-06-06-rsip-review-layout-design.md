# RSIP Review Layout Redesign

**Date:** 2026-06-06
**Status:** approved

## Goal

Improve RSIPReview page layout with a master-detail pattern, and remove the redundant inline "定式复盘" card from the RSIP workbench page.

## Scope

Two files changed, one CSS update:

### 1. RSIP.tsx — Remove Inline Review Panel

- Delete `RsipReviewPanel` component entirely (lines 913–1015)
- Delete `ReviewMetric` helper component (lines 1017–1024)
- Remove associated state: `review`, `reviewLoading`, `reviewTitle`, `reviewDescription`, `deactivationNote`, `reviewError`, `savingReview`, `reviewChanged`
- Remove `loadReview` and `handleSaveReview` functions
- Remove `getRsipFormulaReview` and `updateRsipFormula` imports if no longer used
- Remove sidebar layout references to `rsip-review-card`
- Change each formula tree node's "复盘" button to navigate: `navigate(`/rsip-review?formula=${node.id}`)`

### 2. RSIPReview.tsx — Master-Detail Layout

- **Keep:** Summary metrics grid + insight strip at top (unchanged)
- **Keep:** Three-tab structure (定式复盘 / 事件复盘 / 目标复盘)
- **New — 定式复盘 tab:** Master-detail layout
  - **Left panel (~40% width):** Scrollable list of formula review items. Each item shows: goal kicker, title, risk badge, compact metric row (child status, deactivation count, rollback count, priority score). Clicking selects the item.
  - **Right panel (~60% width):** Detail view for selected formula:
    - Status badge + goal kicker
    - Editable title input + description textarea + save button
    - 6-item metrics grid: created, activated, deactivated, child deps, rollback impact, risk score
    - Latest deactivation note (read-only)
    - Event timeline (compact list)
    - **Excludes:** "Next deactivation note" field (deactivation happens on RSIP page)
- **URL-driven selection:** Read `?formula=` query param on mount, auto-select and scroll to that formula
- **事件复盘 / 目标复盘 tabs:** Keep current layout, minor visual polish only

### 3. global.css — New Layout Styles

- `.rsip-master-detail` — grid container: `grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr)`
- `.rsip-formula-list-panel` — left scrollable panel with border/background
- `.rsip-formula-detail-panel` — right detail panel
- `.rsip-formula-list-item` — compact list item with selected state (gold left border)
- `.rsip-detail-metrics` — 3-column metric grid inside detail panel
- Responsive: stack to single column below 900px

## What stays the same

- Summary metrics and insight strip (top of page)
- Tab bar behavior
- Event review tab (事件复盘)
- Goal review tab (目标复盘)
- All data fetching logic in RSIPReview
- rsipReviewModel.ts (no changes)
- RSIP page tree view and goal view (except removing review panel)

## What is removed

- `RsipReviewPanel` from RSIP.tsx entirely
- "复盘" button on formula nodes → becomes a navigation link
- "下次熄灭备注" field from detail view
