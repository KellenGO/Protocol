import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGlobalActiveFocusSession } from '../lib/db';
import type { GlobalActiveFocusSession } from '../types';

export default function GlobalFocusButton() {
  const navigate = useNavigate();
  const [active, setActive] = useState<GlobalActiveFocusSession | null>(null);

  useEffect(() => {
    function check() {
      getGlobalActiveFocusSession().then(setActive).catch(() => {});
    }
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  if (!active) return null;

  return (
    <button
      className="global-focus-btn"
      onClick={() => navigate(`/chains/${active.chain_id}/focus`)}
      title={`回到专注：${active.chain_name}`}
    >
      回到专注
    </button>
  );
}
