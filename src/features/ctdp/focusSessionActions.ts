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
