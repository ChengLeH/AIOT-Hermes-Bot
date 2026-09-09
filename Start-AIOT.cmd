@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo AIOT requires Node.js 22.12+.
  echo Install it from https://nodejs.org/en/download and run this file again.
  pause
  exit /b 1
)

node "%~dp0scripts\aiot-bootstrap.mjs"
if errorlevel 1 (
  echo.
  echo AIOT could not start. Review the message above and .aiot\aiot.log.
  pause
  exit /b 1
)
endlocal
