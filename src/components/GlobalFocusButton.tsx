import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGlobalActiveFocusSession, getGlobalActiveReservationSession, getAppSettings } from '../lib/db';
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification';
import type { GlobalActiveFocusSession, GlobalActiveReservationSession } from '../types';

type GlobalActiveState =
  | { kind: 'focus'; data: GlobalActiveFocusSession }
  | { kind: 'reservation'; data: GlobalActiveReservationSession }
  | null;

/*
 * 防重复通知策略：
 * - `notifiedRef` 记录 "focus-{id}" 或 "reservation-{id}" 键
 * - 同一 session，只要 ref 已匹配就不再发送系统通知
 * - 同一 session 的 toast 也由 `toastedSessionRef` 独立防重复
 * - due/pending 状态消失时（用户完成/裁决），清空 ref
 * - 应用重启后 ref 自然清空，因此重启后若仍处于 due/pending 状态，会再通知一次
 */
async function shouldSendNotification(): Promise<boolean> {
  try {
    const settings = await getAppSettings();
    const enabled = settings.find((s) => s.key === 'enable_notifications')?.value;
    if (enabled !== '1') return false;
    return await isPermissionGranted();
  } catch {
    return false;
  }
}

export default function GlobalFocusButton() {
  const navigate = useNavigate();
  const [active, setActive] = useState<GlobalActiveState>(null);
  const [isDue, setIsDue] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const toastedSessionRef = useRef<string | null>(null);
  const notifiedRef = useRef<string | null>(null);

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
              notifiedRef.current = null;
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

              if (due && notifiedRef.current !== toastKey) {
                shouldSendNotification().then((ok) => {
                  if (ok) {
                    notifiedRef.current = toastKey;
                    sendNotification({ title: 'Protocol', body: '专注时间已到，请确认完成任务' });
                  }
                });
              }

              if (!due) {
                toastedSessionRef.current = null;
                notifiedRef.current = null;
              }
            }
            return;
          }

          if (reservation) {
            setActive({ kind: 'reservation', data: reservation });
            const confirming = reservation.phase === 'confirming' || reservation.pending_ruling;
            setIsDue(confirming);
            const toastKey = `reservation-${reservation.id}`;
            if (confirming && toastedSessionRef.current !== toastKey) {
              toastedSessionRef.current = toastKey;
              setShowToast(true);
              setTimeout(() => setShowToast(false), 4000);
            }

            if (confirming && notifiedRef.current !== toastKey) {
              shouldSendNotification().then((ok) => {
                if (ok) {
                  notifiedRef.current = toastKey;
                  sendNotification({ title: 'Protocol', body: '辅助链已到期，请履约或进入裁决' });
                }
              });
            }

            if (!confirming) {
              setShowToast(false);
              toastedSessionRef.current = null;
              notifiedRef.current = null;
            }
            return;
          }

          setActive(null);
          setIsDue(false);
          setShowToast(false);
          toastedSessionRef.current = null;
          notifiedRef.current = null;
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
      : `/chains/${active.data.chain_id}?mode=aux`;

  return (
    <>
      {showToast && (
        <div className="global-toast" role="status" aria-live="polite">
          {active.kind === 'reservation'
            ? '辅助链进入确认窗口，请进入主链或准备裁决'
            : '神圣座位时间已到，请确认主链完成'}
        </div>
      )}

      <button
        className={`global-focus-btn ${isDue ? 'focus-due' : ''}`}
        onClick={() => navigate(target)}
        title={`${label}：${active.data.chain_name}`}
        aria-label={`${label}：${active.data.chain_name}`}
      >
        {label}
      </button>
    </>
  );
}

function getLabel(active: NonNullable<GlobalActiveState>, isDue: boolean): string {
  if (active.kind === 'focus') {
    if (active.data.pending_ruling) return '神圣座位待裁决';
    return isDue ? '主链待完成' : '回到神圣座位';
  }

  if (active.data.pending_ruling) return '辅助链待裁决';
  if (active.data.phase === 'confirming') return '辅助链待确认';
  return isDue ? '辅助链待确认' : '辅助链预约中';
}
