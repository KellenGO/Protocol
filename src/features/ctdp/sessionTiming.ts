export type ReservationCountdownPhase = 'countdown' | 'confirming';

export type ReservationTimeState =
  | { phase: 'countdown' | 'confirming'; remainingSeconds: number }
  | { phase: 'expired'; remainingSeconds: 0 }
  | { phase: 'timing-error'; error: string };

export interface ReservationDeadlineSource {
  due_at: string;
  confirmation_due_at: string | null;
}

const sqliteUtcTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/;

export function parseSqliteUtcTimestamp(value: string): number {
  const trimmed = value.trim();
  const match = sqliteUtcTimestampPattern.exec(trimmed);
  if (!match) {
    throw new Error('会话截止时间无效');
  }

  const normalized = trimmed.endsWith('Z')
    ? trimmed.replace(' ', 'T')
    : `${trimmed.replace(' ', 'T')}Z`;
  const timestamp = Date.parse(normalized);
  const parsed = new Date(timestamp);
  const [, year, month, day, hour, minute, second] = match;
  if (
    !Number.isFinite(timestamp)
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
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

export function resolveReservationTimeState(
  reservation: ReservationDeadlineSource,
  nowMs = Date.now(),
): ReservationTimeState {
  try {
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
  } catch (error) {
    return {
      phase: 'timing-error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
