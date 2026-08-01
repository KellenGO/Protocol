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
