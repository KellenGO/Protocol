import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGlobalActiveFocusSession, getGlobalActiveReservationSession } from '../lib/db';
import type { GlobalActiveFocusSession, GlobalActiveReservationSession } from '../types';

type GlobalActiveState =
  | { kind: 'focus'; data: GlobalActiveFocusSession }
  | { kind: 'reservation'; data: GlobalActiveReservationSession }
  | null;

export default function GlobalFocusButton() {
  const navigate = useNavigate();
  const [active, setActive] = useState<GlobalActiveState>(null);
  const [isDue, setIsDue] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const toastedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    function check() {
      Promise.all([getGlobalActiveFocusSession(), getGlobalActiveReservationSession()])
        .then(([focus, reservation]) => {
          if (focus) {
            setActive({ kind: 'focus', data: focus });

            if (focus.pending_ruling) {
              setIsDue(false);
              setShowToast(false);
              toastedSessionRef.current = null;
              return;
            }

            if (focus.expected_end_at) {
              const end = new Date(focus.expected_end_at + 'Z').getTime();
              const due = end <= Date.now();
              setIsDue(due);

              const toastKey = `focus-${focus.id}`;
              if (due && toastedSessionRef.current !== toastKey) {
                toastedSessionRef.current = toastKey;
                setShowToast(true);
                setTimeout(() => setShowToast(false), 4000);
              }

              if (!due) toastedSessionRef.current = null;
            }
            return;
          }

          if (reservation) {
            setActive({ kind: 'reservation', data: reservation });
            setIsDue(false);
            setShowToast(false);
            toastedSessionRef.current = null;
            return;
          }

          setActive(null);
          setIsDue(false);
          setShowToast(false);
          toastedSessionRef.current = null;
        })
        .catch(() => {});
    }

    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  if (!active) return null;

  const label = getLabel(active, isDue);
  const target =
    active.kind === 'focus'
      ? `/chains/${active.data.chain_id}/focus${active.data.pending_ruling ? '?mode=ruling' : ''}`
      : `/reservation${active.data.pending_ruling ? '?mode=ruling' : ''}`;

  return (
    <>
      {showToast && (
        <div className="global-toast">
          专注时间已到，请确认完成任务
        </div>
      )}

      <button
        className={`global-focus-btn ${isDue ? 'focus-due' : ''}`}
        onClick={() => navigate(target)}
        title={`${label}：${active.data.chain_name}`}
      >
        {label}
      </button>
    </>
  );
}

function getLabel(active: NonNullable<GlobalActiveState>, isDue: boolean): string {
  if (active.kind === 'focus') {
    if (active.data.pending_ruling) return '主链待裁决';
    return isDue ? '专注已完成' : '回到专注';
  }

  if (active.data.pending_ruling) return '预约待裁决';
  return '查看预约';
}
