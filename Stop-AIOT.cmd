@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo AIOT requires Node.js 22.12+.
  pause
  exit /b 1
)
node "%~dp0scripts\aiot-service.mjs" stop
if errorlevel 1 (
  echo AIOT could not stop. Review .aiot\aiot.log.
  pause
  exit /b 1
)
endlocal
