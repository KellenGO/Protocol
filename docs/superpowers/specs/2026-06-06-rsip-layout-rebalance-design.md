# RSIP Page Layout Rebalance

**Date:** 2026-06-06
**Status:** approved

## Goal

Rebalance the RSIP workbench page (RSIP.tsx tree view) — the right sidebar's "最近RSIP事件" card was disproportionately long compared to the left tree panel, creating visual imbalance. Also apply the principle that "创建定式" is an action (not passive info), so it should be a button that expands, not an always-visible card.

## Design: Balanced Two-Column (方案 A)

### Layout structure

```
┌─ Header ───────────────────────────────────────────────────┐
│ RSIP 定式树 · subtitle       [定式树|目标] [+创建] [转译]  │
├─ (Expandable: "+创建定式" clicked → inline form) ──────────┤
├─ Stats bar (horizontal) ───────────────────────────────────┤
│   9 定式   │   5 点亮   │   4 未点亮   │   3 Goals         │
├─ Tree (60%) ───────────────┬─ Events (40%) ────────────────┤
│ ● parent   (full-width)    │ deactivated  title    time    │
│   ↳ child  (indented 22px) │ activated    title    time    │
│ ● parent                    │ created      title    time    │
│                             │ (max ~6 items)               │
└─────────────────────────────┴──────────────────────────────┘
```

### Changes

#### 1. Header bar redesign
- Merge current page-header buttons + view-toggle into one compact header row
- View toggle: pill-style segmented control (定式树 | 目标)
- "+ 创建定式" button (secondary/gold outline pill) — toggles inline form expansion
- "新建目标转译" button (primary gold pill)
- Remove redundant "查看目标" standalone button (view toggle already covers this)

#### 2. "创建定式" becomes expandable
- Default: hidden (just the button)
- Click: inline card slides down between header and stats bar
- Shows: title input, description textarea, parent formula selector (if applicable), submit button
- State management: `showCreateForm` boolean in component state

#### 3. Stats bar
- Replace `rsip-summary-grid` with a horizontal inline stats bar
- 4 equal columns, compact layout (smaller numbers, inline labels)
- Border-separated, no card backgrounds — integrated into the page surface
- Keep existing color semantics (点亮=green tint)

#### 4. Two-column content area (tree + events)
- Grid: `minmax(0, 1.5fr)` for tree, `minmax(0, 1fr)` for events
- Tree panel: same FormulaTreeNode component, unchanged behavior
- Events panel: compact vertical list, show latest ~6 items
  - Each event: `[event-type badge] [formula title] [time]` in one row
  - Significantly more compact than current card layout
  - Title truncated with ellipsis if too long

#### 5. Goal view
- Unchanged — the `GoalListView` layout stays as-is
- When switching to goals view, the two-column tree+events is hidden, goal layout takes over

### What stays the same
- Formula tree nodes (indentation, status badges, actions)
- "复盘" button navigates to `/rsip-review?formula=id`
- "点亮/熄灭" buttons behavior
- "加子定式" sets parentId
- `GoalTranslationWizard` component
- All data fetching and state management logic

### Files changed
- `src/pages/RSIP.tsx` — structural JSX changes
- `src/styles/global.css` — new header bar, stats bar, two-column layout styles
