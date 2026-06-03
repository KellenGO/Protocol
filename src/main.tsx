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
      const parts: string[] = [];
      if (focus) parts.push(`神圣座位「${focus.chain_name}」${focus.pending_ruling ? '待裁决' : '进行中'}`);
      if (reservation) parts.push(`辅助链「${reservation.chain_name}」${reservation.pending_ruling ? '待裁决' : '进行中'}`);

      const lines: string[] = [
        'Protocol 中有活跃的协议流程：',
        '',
        ...parts.map((p) => `  ${p}`),
        '',
        '关闭窗口不会自动结束协议，协议状态将在数据库中保留。',
        '重新打开应用后，你仍需回到任务页完成或裁决。',
        '',
        '确定要关闭窗口吗？',
      ];

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
