@echo off
rem ---------------------------------------------------------------------
rem  Power Stage - double-click launcher.
rem
rem  Starts the local server and opens the tool in your default browser.
rem  Leave this window open while you use it; closing it stops the server.
rem ---------------------------------------------------------------------

cd /d "%~dp0"
title Power Stage

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or is not on your PATH.
  echo   Install the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\vite" (
  echo.
  echo   First run - installing dependencies. This takes a minute.
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo   Install failed. Check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Starting Power Stage. Your browser will open in a moment.
echo   Close this window when you are done.
echo.

call npm run dev -- --open

rem If the server exits immediately something went wrong - hold the window
rem open so the error is readable instead of vanishing.
if errorlevel 1 pause
