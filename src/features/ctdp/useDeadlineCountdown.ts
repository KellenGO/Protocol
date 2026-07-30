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
