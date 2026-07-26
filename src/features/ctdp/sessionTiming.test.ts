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

test('rejects a SQLite timestamp with an impossible calendar date', () => {
  assert.throws(() => parseSqliteUtcTimestamp('2026-02-30 12:00:00'), /会话截止时间无效/);
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
