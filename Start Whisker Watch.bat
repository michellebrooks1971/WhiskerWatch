@echo off
title Whisker Watch
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is required but was not found.
  echo Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

rem open the browser a moment after the server starts
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:4780"

node server.js
pause
