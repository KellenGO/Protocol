import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getGlobalActiveFocusSession, getGlobalActiveReservationSession } from './lib/db';
import App from './App';
import './styles/global.css';

// --- Window close guard: warn if active sessions exist ---
let forceClose = false;
const appWindow = getCurrentWindow();

appWindow.onCloseRequested(async (event: { preventDefault: () => void }) => {
  if (forceClose) return;

  try {
    const [focus, reservation] = await Promise.all([
      getGlobalActiveFocusSession(),
      getGlobalActiveReservationSession(),
    ]);

    if (focus || reservation) {
      event.preventDefault();
      const lines: string[] = ['当前有活跃的协议流程：'];
      if (focus) lines.push(`· 神圣座位：${focus.chain_name}${focus.pending_ruling ? '（待裁决）' : ''}`);
      if (reservation) lines.push(`· 辅助链：${reservation.chain_name}${reservation.pending_ruling ? '（待裁决）' : ''}`);
      lines.push('');
      lines.push('关闭窗口不会结束协议，协议状态将被保留。');
      lines.push('确定要关闭吗？');

      const confirmed = window.confirm(lines.join('\n'));
      if (confirmed) {
        forceClose = true;
        await appWindow.close();
      }
    }
  } catch {
    // If DB calls fail, allow the close to proceed
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
