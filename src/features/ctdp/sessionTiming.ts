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
    throw new Error('浼氳瘽鎴鏃堕棿鏃犳晥');
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
