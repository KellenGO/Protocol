# CTDP Timer and Outcome Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CTDP focus and reservation countdowns derive from absolute backend deadlines, and let a user choose completion or ruling after a focus deadline.

**Architecture:** Put UTC deadline parsing and remaining-time calculation in a React-free CTDP utility, and put interval/visibility/focus refresh behavior in one small React hook. Keep session transitions in the existing pages; extract the focus action decision into a pure model so the changed outcome rule is unit-testable without a new UI testing dependency.

**Tech Stack:** TypeScript 6, React 19, Node built-in test runner, Vite 8, Tauri 2.

## Global Constraints

- `expected_end_at`, `due_at`, and `confirmation_due_at` are the only countdown time sources.
- An interval may trigger recalculation, but must never derive time with `previous - 1`.
- Refresh immediately when the document becomes visible and when the window receives focus.
- At a zero-second focus deadline, show both `确认主链完成` and `未完成，进入裁决`.
- Preserve the existing ability to enter ruling before the focus deadline.
- Preserve existing completion, ruling, chain-length, precedent, reservation-duration, and fulfillment semantics.
- Add no runtime or development dependency.
- Do not redesign session pages or global styles.
- Use Node `>=20.19`; unit tests must not rely on Node 22+ TypeScript type stripping.
- Use UTF-8 Chinese UI copy and match existing naming and formatting.

---

## File Map

- Create `src/features/ctdp/sessionTiming.ts`: parse SQLite UTC timestamps, calculate remaining seconds, and select reservation deadlines.
- Create `src/features/ctdp/sessionTiming.test.ts`: pure time and reservation-deadline tests.
- Create `src/features/ctdp/useDeadlineCountdown.ts`: shared React interval, visibility, and focus refresh behavior.
- Create `src/features/ctdp/focusSessionActions.ts`: pure focus action-state model.
- Create `src/features/ctdp/focusSessionActions.test.ts`: before/after deadline action tests.
- Create `scripts/run-unit-tests.mjs`: cross-platform launcher for compiled Node tests.
- Create `tsconfig.unit.json`: emit only the selected pure TypeScript modules and tests as Node ESM.
- Modify `.gitignore`: ignore `.unit-tests/`.
- Modify `package.json`: add `test:unit`.
- Modify `src/pages/FocusSession.tsx`: consume the deadline hook and action model, remove decrement timer, and render both due actions.
- Modify `src/pages/AuxiliarySession.tsx`: consume the deadline hook and reservation deadline selector, remove decrement timer, and stop transitions on invalid deadlines.

---

### Task 1: Absolute deadline utility and dependency-free unit test runner

**Files:**
- Create: `src/features/ctdp/sessionTiming.test.ts`
- Create: `src/features/ctdp/sessionTiming.ts`
- Create: `scripts/run-unit-tests.mjs`
- Create: `tsconfig.unit.json`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseSqliteUtcTimestamp(value: string): number`
- Produces: `calculateRemainingSeconds(deadline: string, nowMs?: number): number`
- Produces: `reservationDeadlineForPhase(reservation: ReservationDeadlineSource, phase: ReservationCountdownPhase): string`
- Produces: `npm run test:unit`

- [ ] **Step 1: Add the runner configuration and failing time tests**

Add this script to `package.json`:

```json
"test:unit": "tsc -p tsconfig.unit.json && node scripts/run-unit-tests.mjs"
```

Add `.unit-tests/` to `.gitignore`.

Create `tsconfig.unit.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "rootDir": "src",
    "outDir": ".unit-tests",
    "noEmit": false
  },
  "include": [
    "src/features/ctdp/sessionTiming.ts",
    "src/features/ctdp/sessionTiming.test.ts",
    "src/features/ctdp/focusSessionActions.ts",
    "src/features/ctdp/focusSessionActions.test.ts"
  ]
}
```

Create `scripts/run-unit-tests.mjs`:

```js
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTests(directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? collectTests(path) : [path];
    })
    .filter((path) => path.endsWith('.test.js'));
}

const outputDirectory = resolve('.unit-tests');
const tests = collectTests(outputDirectory);
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });

process.exit(result.status ?? 1);
```

Create `src/features/ctdp/sessionTiming.test.ts` before the implementation:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRemainingSeconds,
  parseSqliteUtcTimestamp,
  reservationDeadlineForPhase,
} from './sessionTiming.js';

test('rounds a future deadline up to the next whole second', () => {
  assert.equal(calculateRemainingSeconds('2026-07-26 12:00:01.500', Date.UTC(2026, 6, 26, 12, 0, 0)), 2);
});

test('returns zero at and after the deadline', () => {
  const deadline = '2026-07-26 12:00:00';
  const exact = Date.UTC(2026, 6, 26, 12, 0, 0);
  assert.equal(calculateRemainingSeconds(deadline, exact), 0);
  assert.equal(calculateRemainingSeconds(deadline, exact + 60_000), 0);
});

test('parses SQLite timestamps as UTC', () => {
  assert.equal(parseSqliteUtcTimestamp('2026-07-26 12:00:00'), Date.UTC(2026, 6, 26, 12, 0, 0));
});

test('rejects an invalid deadline instead of treating it as due', () => {
  assert.throws(() => calculateRemainingSeconds('not-a-time', 0), /会话截止时间无效/);
});

test('selects the deadline for each reservation phase', () => {
  const reservation = {
    due_at: '2026-07-26 12:00:00',
    confirmation_due_at: '2026-07-26 12:05:00',
  };
  assert.equal(reservationDeadlineForPhase(reservation, 'countdown'), reservation.due_at);
  assert.equal(
    reservationDeadlineForPhase(reservation, 'confirming'),
    reservation.confirmation_due_at,
  );
});

test('falls back to due_at when an old reservation has no confirmation deadline', () => {
  const reservation = {
    due_at: '2026-07-26 12:00:00',
    confirmation_due_at: null,
  };
  assert.equal(reservationDeadlineForPhase(reservation, 'confirming'), reservation.due_at);
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run:

```powershell
npm.cmd run test:unit
```

Expected: TypeScript compilation fails because `./sessionTiming.js` cannot be resolved or its exports do not exist.

- [ ] **Step 3: Implement the minimal pure deadline utility**

Create `src/features/ctdp/sessionTiming.ts`:

```ts
export type ReservationCountdownPhase = 'countdown' | 'confirming';

export interface ReservationDeadlineSource {
  due_at: string;
  confirmation_due_at: string | null;
}

export function parseSqliteUtcTimestamp(value: string): number {
  const trimmed = value.trim();
  const normalized = trimmed.endsWith('Z')
    ? trimmed
    : `${trimmed.replace(' ', 'T')}Z`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error('会话截止时间无效');
  }
  return timestamp;
}

export function calculateRemainingSeconds(deadline: string, nowMs = Date.now()): number {
  const deadlineMs = parseSqliteUtcTimestamp(deadline);
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function reservationDeadlineForPhase(
  reservation: ReservationDeadlineSource,
  phase: ReservationCountdownPhase,
): string {
  if (phase === 'confirming') {
    return reservation.confirmation_due_at ?? reservation.due_at;
  }
  return reservation.due_at;
}
```

- [ ] **Step 4: Run the unit tests and verify the green state**

Run:

```powershell
npm.cmd run test:unit
```

Expected: 6 tests pass, 0 fail.

- [ ] **Step 5: Run focused static checks**

Run:

```powershell
npm.cmd run typecheck
npm.cmd run lint
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- .gitignore package.json scripts/run-unit-tests.mjs tsconfig.unit.json src/features/ctdp/sessionTiming.ts src/features/ctdp/sessionTiming.test.ts
git commit -m "test: add CTDP deadline unit coverage"
```

---

### Task 2: Focus countdown refresh and due outcome choice

**Files:**
- Create: `src/features/ctdp/focusSessionActions.test.ts`
- Create: `src/features/ctdp/focusSessionActions.ts`
- Create: `src/features/ctdp/useDeadlineCountdown.ts`
- Modify: `src/pages/FocusSession.tsx:1-144`
- Modify: `src/pages/FocusSession.tsx:323-351`

**Interfaces:**
- Consumes: `calculateRemainingSeconds(deadline: string, nowMs?: number): number`
- Produces: `getFocusSessionActionState(remainingSeconds: number): FocusSessionActionState`
- Produces: `useDeadlineCountdown(deadline: string | null, active: boolean): DeadlineCountdown`

- [ ] **Step 1: Add a failing test for the focus action rule**

Create `src/features/ctdp/focusSessionActions.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { getFocusSessionActionState } from './focusSessionActions.js';

test('running focus sessions allow ruling but not completion', () => {
  assert.deepEqual(getFocusSessionActionState(1), {
    timerDone: false,
    showComplete: false,
    showRuling: true,
  });
});

test('due focus sessions allow both completion and ruling', () => {
  assert.deepEqual(getFocusSessionActionState(0), {
    timerDone: true,
    showComplete: true,
    showRuling: true,
  });
});
```

- [ ] **Step 2: Run the unit tests and verify the red state**

Run:

```powershell
npm.cmd run test:unit
```

Expected: TypeScript compilation fails because `./focusSessionActions.js` cannot be resolved or `getFocusSessionActionState` does not exist.

- [ ] **Step 3: Implement the focus action model**

Create `src/features/ctdp/focusSessionActions.ts`:

```ts
export interface FocusSessionActionState {
  timerDone: boolean;
  showComplete: boolean;
  showRuling: boolean;
}

export function getFocusSessionActionState(remainingSeconds: number): FocusSessionActionState {
  const timerDone = remainingSeconds <= 0;
  return {
    timerDone,
    showComplete: timerDone,
    showRuling: true,
  };
}
```

- [ ] **Step 4: Implement the shared deadline countdown hook**

Create `src/features/ctdp/useDeadlineCountdown.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { calculateRemainingSeconds } from './sessionTiming';

export interface DeadlineCountdown {
  remainingSeconds: number;
  deadlineError: string | null;
  refresh: () => void;
}

export function useDeadlineCountdown(
  deadline: string | null,
  active: boolean,
): DeadlineCountdown {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const refresh = useCallback(() => setNowMs(Date.now()), []);

  const snapshot = useMemo(() => {
    if (!active || !deadline) {
      return { remainingSeconds: 0, deadlineError: null };
    }
    try {
      return {
        remainingSeconds: calculateRemainingSeconds(deadline, nowMs),
        deadlineError: null,
      };
    } catch (error) {
      return {
        remainingSeconds: 0,
        deadlineError: error instanceof Error ? error.message : String(error),
      };
    }
  }, [active, deadline, nowMs]);

  useEffect(() => {
    if (!active || !deadline || snapshot.deadlineError) return;

    refresh();
    const intervalId = window.setInterval(refresh, 1000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', refresh);
    };
  }, [active, deadline, refresh, snapshot.deadlineError]);

  return { ...snapshot, refresh };
}
```

- [ ] **Step 5: Replace the focus page decrement timer**

In `src/pages/FocusSession.tsx`:

- Remove `useRef` and `timerRef`.
- Import `getFocusSessionActionState` and `useDeadlineCountdown`.
- Stop calculating and storing remaining time during `init`.
- Derive countdown state exactly as follows after React state declarations:

```ts
const {
  remainingSeconds: remaining,
  deadlineError,
  refresh: refreshDeadline,
} = useDeadlineCountdown(
  session?.expected_end_at ?? null,
  phase === 'running',
);
```

- Remove both effects that decrement remaining and clear the interval.
- In `returnToTask`, remove manual `Date` math, set the phase to running, and call `refreshDeadline()`.
- Treat `error || deadlineError` as the page error.

- [ ] **Step 6: Render the due outcome choices from the tested model**

Replace `const isTimerDone = remaining === 0` with:

```ts
const actionState = getFocusSessionActionState(remaining);
const isTimerDone = actionState.timerDone;
```

Render actions without an either/or branch:

```tsx
{actionState.showComplete && (
  <button className="btn btn-primary btn-large" onClick={handleComplete}>
    确认主链完成
  </button>
)}
{actionState.showRuling && (
  <button className="btn btn-danger-outline" onClick={enterRuling}>
    {isTimerDone ? '未完成，进入裁决' : '进入裁决'}
  </button>
)}
```

Keep the existing return button after these actions.

- [ ] **Step 7: Run Task 2 verification**

Run:

```powershell
npm.cmd run test:unit
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: 8 unit tests pass; typecheck, lint, and build exit 0.

Also run:

```powershell
rg -n "setRemaining\\(\\(prev|setInterval|timerRef" src/pages/FocusSession.tsx
```

Expected: no matches.

- [ ] **Step 8: Commit Task 2**

```powershell
git add -- src/features/ctdp/focusSessionActions.ts src/features/ctdp/focusSessionActions.test.ts src/features/ctdp/useDeadlineCountdown.ts src/pages/FocusSession.tsx
git commit -m "fix: make focus deadline outcomes trustworthy"
```

---

### Task 3: Auxiliary countdown absolute-time integration

**Files:**
- Modify: `src/pages/AuxiliarySession.tsx:1-180`
- Test: `src/features/ctdp/sessionTiming.test.ts`

**Interfaces:**
- Consumes: `reservationDeadlineForPhase(reservation, phase): string`
- Produces: `resolveReservationTimeState(reservation, nowMs?): ReservationTimeState`
- Consumes: `useDeadlineCountdown(deadline, active): DeadlineCountdown`
- Preserves: existing `expireReservationSession`, phase transition, fulfillment, and ruling APIs

- [ ] **Step 1: Add a failing test for sleep/resume phase convergence**

Add `resolveReservationTimeState` to the import list in `src/features/ctdp/sessionTiming.test.ts`, then add:

```ts
test('converges reservation state from both absolute deadlines', () => {
  const reservation = {
    due_at: '2026-07-26 12:00:00',
    confirmation_due_at: '2026-07-26 12:05:00',
  };
  assert.deepEqual(
    resolveReservationTimeState(reservation, Date.UTC(2026, 6, 26, 11, 59, 59, 500)),
    { phase: 'countdown', remainingSeconds: 1 },
  );
  assert.deepEqual(
    resolveReservationTimeState(reservation, Date.UTC(2026, 6, 26, 12, 2, 0)),
    { phase: 'confirming', remainingSeconds: 180 },
  );
  assert.deepEqual(
    resolveReservationTimeState(reservation, Date.UTC(2026, 6, 26, 12, 6, 0)),
    { phase: 'expired', remainingSeconds: 0 },
  );
});
```

- [ ] **Step 2: Run the unit tests and verify the red state**

Run:

```powershell
npm.cmd run test:unit
```

Expected: TypeScript compilation fails because `resolveReservationTimeState` is not exported.

- [ ] **Step 3: Implement absolute reservation phase convergence**

Add to `src/features/ctdp/sessionTiming.ts`:

```ts
export type ReservationTimeState =
  | { phase: 'countdown' | 'confirming'; remainingSeconds: number }
  | { phase: 'expired'; remainingSeconds: 0 };

export function resolveReservationTimeState(
  reservation: ReservationDeadlineSource,
  nowMs = Date.now(),
): ReservationTimeState {
  const reservationRemaining = calculateRemainingSeconds(reservation.due_at, nowMs);
  if (reservationRemaining > 0) {
    return { phase: 'countdown', remainingSeconds: reservationRemaining };
  }

  const confirmationRemaining = calculateRemainingSeconds(
    reservation.confirmation_due_at ?? reservation.due_at,
    nowMs,
  );
  if (confirmationRemaining > 0) {
    return { phase: 'confirming', remainingSeconds: confirmationRemaining };
  }
  return { phase: 'expired', remainingSeconds: 0 };
}
```

Run:

```powershell
npm.cmd run test:unit
```

Expected: 9 tests pass, 0 fail.

- [ ] **Step 4: Replace auxiliary local decrement state with the deadline hook**

In `src/pages/AuxiliarySession.tsx`:

- Remove `timerRef` and the `remaining` state.
- Remove the local `reservationTargetTime` function.
- Import `reservationDeadlineForPhase`, `resolveReservationTimeState`, and `useDeadlineCountdown`.
- Derive the active countdown phase, selected deadline, and countdown:

```ts
const countdownPhase =
  phase === 'countdown' || phase === 'confirming' ? phase : null;
const deadline =
  reservation && countdownPhase
    ? reservationDeadlineForPhase(reservation, countdownPhase)
    : null;
const {
  remainingSeconds: remaining,
  deadlineError,
} = useDeadlineCountdown(deadline, countdownPhase !== null);
```

- During `load`, remove `target`, `left`, and `setRemaining`; set only the reservation and phase.
- Remove the interval effect.
- In the zero-second phase-transition effect, return immediately when `deadlineError` is non-null.
- When the current phase is countdown and remaining reaches zero, call `resolveReservationTimeState(reservation)`.
  - For `confirming`, update `reservation.phase` and `phase`; do not calculate or store a new remaining value.
  - For `expired`, call the existing `expireAuxiliary` immediately so waking after both deadlines does not stop briefly in confirming.
- Include `deadlineError` in the existing page error display without copying it into mutable error state.

- [ ] **Step 5: Verify auxiliary behavior and the absence of decrement timers**

Run:

```powershell
npm.cmd run test:unit
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: 9 unit tests pass; typecheck, lint, and build exit 0.

Run:

```powershell
rg -n "setRemaining\\(\\(prev|timerRef|function reservationTargetTime" src/pages/AuxiliarySession.tsx
```

Expected: no matches.

- [ ] **Step 6: Perform the manual state matrix**

Run the Tauri app and verify:

1. Start a focus session with time remaining: only `进入裁决` is shown.
2. Let the focus deadline pass: both `确认主链完成` and `未完成，进入裁决` are shown.
3. Put the machine to sleep across a focus deadline: the page shows zero immediately after resume.
4. Start a reservation: countdown uses `due_at`.
5. Put the machine to sleep across the reservation deadline: the page enters confirming and uses `confirmation_due_at`.
6. Put the machine to sleep across the confirmation deadline: the page enters ruling.
7. Open ruling after the focus deadline, return to task, and verify the page returns to the zero-second dual-action state.

- [ ] **Step 7: Run final repository checks**

Run:

```powershell
npm.cmd run check
npm.cmd run build
Push-Location src-tauri
cargo test --locked
Pop-Location
git diff --check
git status --short
```

Expected:

- Frontend check and build exit 0.
- Rust tests exit 0 after `dist` exists from the frontend build.
- `git diff --check` reports no whitespace errors.
- `git status --short` lists only the intentional Task 3 changes before commit.

- [ ] **Step 8: Commit Task 3**

```powershell
git add -- src/features/ctdp/sessionTiming.ts src/features/ctdp/sessionTiming.test.ts src/pages/AuxiliarySession.tsx
git commit -m "fix: keep reservation countdowns aligned"
```

---

## Final Acceptance Checklist

- [ ] Focus due state offers both completion and ruling.
- [ ] Focus running state still allows early ruling.
- [ ] Focus and auxiliary pages contain no decrement-based countdown.
- [ ] Countdown recalculates every second and on visibility/focus recovery.
- [ ] Invalid deadlines surface an error and do not trigger a false due transition.
- [ ] Reservation deadline selection preserves the old-data fallback.
- [ ] Unit tests pass without adding a dependency.
- [ ] Frontend typecheck, lint, build, and Rust tests pass.
- [ ] Manual sleep/resume matrix has been executed or any unavailable cases are reported explicitly.
