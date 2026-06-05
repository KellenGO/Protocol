import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm } from '@tauri-apps/plugin-dialog';
import { getGlobalActiveFocusSession, getGlobalActiveReservationSession } from './lib/db';
import App from './App';
import './styles/global.css';

// --- Window close guard: hide to tray with confirmation if active sessions exist ---
const appWindow = getCurrentWindow();

// Register the close-requested listener before rendering the app.
// The await ensures the listener is active before any user interaction.
const _closeUnlisten = await appWindow.onCloseRequested(async (event) => {
  // Always prevent window destruction — we hide to tray instead.
  // The tray icon keeps the process alive; "退出 Protocol" in the tray menu exits.
  event.preventDefault();

  try {
    const [focus, reservation] = await Promise.all([
      getGlobalActiveFocusSession(),
      getGlobalActiveReservationSession(),
    ]);

    if (focus || reservation) {
      const parts: string[] = [];
      if (focus) parts.push(`神圣座位「${focus.chain_name}」${focus.pending_ruling ? '待裁决' : '进行中'}`);
      if (reservation) parts.push(`辅助链「${reservation.chain_name}」${reservation.pending_ruling ? '待裁决' : '进行中'}`);

      const confirmed = await confirm(
        'Protocol 中有活跃的协议流程：\n\n' +
        parts.map((p) => `  ${p}`).join('\n') +
        '\n\n关闭窗口不会自动结束协议，协议状态将在数据库中保留。\n' +
        '你可以在系统托盘中找到 Protocol，随时重新打开。\n\n' +
        '确定要隐藏窗口到托盘吗？',
        { title: 'Protocol', kind: 'warning' },
      );
      if (!confirmed) return;
    }
  } catch {
    // If DB calls fail, still allow hiding to tray
  }

  // Defer hide with setTimeout to avoid conflicting with the close event processing
  setTimeout(() => {
    appWindow.hide();
  }, 0);
});

void _closeUnlisten;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
