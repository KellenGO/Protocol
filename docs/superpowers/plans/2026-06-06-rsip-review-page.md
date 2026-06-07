# RSIP Review Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only RSIP review page that mirrors the existing protocol review hierarchy.

**Architecture:** Keep RSIP workbench behavior unchanged. Add a small pure model helper for review summaries and a React page that reads existing RSIP formulas, goals, and formula events. Reuse the existing review-page CSS primitives with a few RSIP-specific selectors.

**Tech Stack:** React, TypeScript, React Router, existing Tauri DB wrappers, CSS.

---

### Task 1: RSIP Review Model

**Files:**
- Create: `src/pages/rsipReviewModel.ts`
- Create: `src/pages/rsipReviewModel.test.ts`

- [ ] **Step 1: Write the failing test**

Create tests that import `summarizeRsipReview`, feed representative formulas/goals/events, and assert summary counts plus priority ordering.

- [ ] **Step 2: Run test to verify it fails**

Run TypeScript compile for the test and model. Expected: FAIL because `rsipReviewModel.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement pure helper functions for formula summary, event summary, goal lookup, review priority, and sorted formula review items.

- [ ] **Step 4: Run test to verify it passes**

Compile the test to a temporary output directory and run it with Node. Expected: PASS.

### Task 2: RSIP Review Page And Routing

**Files:**
- Create: `src/pages/RSIPReview.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add the page**

Create a read-only page with tabs for formulas, events, and goals. Load existing RSIP formulas, goals, and formula events.

- [ ] **Step 2: Wire navigation**

Add `/rsip-review` route and a sidebar item labeled `RSIP复盘`.

- [ ] **Step 3: Add CSS**

Reuse review cards, summary metrics, status badges, and compact list styling. Add only RSIP-specific layout selectors.

- [ ] **Step 4: Verify**

Run `npm.cmd run typecheck`, `npm.cmd run build`, and `cargo check`.
