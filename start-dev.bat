@echo off
setlocal

cd /d "%~dp0"
echo Starting Protocol in Tauri dev mode...

call npm run tauri dev
if errorlevel 1 (
  echo.
  echo Failed to start Protocol.
  pause
)

endlocal
