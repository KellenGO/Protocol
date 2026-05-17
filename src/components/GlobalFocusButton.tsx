import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGlobalActiveFocusSession } from '../lib/db';
import type { GlobalActiveFocusSession } from '../types';

export default function GlobalFocusButton() {
  const navigate = useNavigate();
  const [active, setActive] = useState<GlobalActiveFocusSession | null>(null);
  const [isDue, setIsDue] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const toastedSessionRef = useRef<number | null>(null);

  useEffect(() => {
    function check() {
      getGlobalActiveFocusSession()
        .then((s) => {
          setActive(s);
          if (s && s.expected_end_at) {
            const end = new Date(s.expected_end_at + 'Z').getTime();
            const now = Date.now();
            const due = end <= now;
            setIsDue(due);

            if (due && toastedSessionRef.current !== s.id) {
              toastedSessionRef.current = s.id;
              setShowToast(true);
              setTimeout(() => setShowToast(false), 4000);
            }

            if (!due) {
              toastedSessionRef.current = null;
            }
          } else {
            setIsDue(false);
          }
        })
        .catch(() => {});
    }
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  if (!active) return null;

  return (
    <>
      {showToast && (
        <div className="global-toast">
          专注时间已到，请确认完成任务
        </div>
      )}

      <button
        className={`global-focus-btn ${isDue ? 'focus-due' : ''}`}
        onClick={() => navigate(`/chains/${active.chain_id}/focus`)}
        title={`${isDue ? '专注已完成' : '回到专注'}：${active.chain_name}`}
      >
        {isDue ? '专注已完成' : '回到专注'}
      </button>
    </>
  );
}
