@echo off
title Customer Purchase Pattern Analysis - local server
cd /d "%~dp0"

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo Node.js was not found. Install from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Starting website at http://127.0.0.1:8080/
echo Keep this window open while you use the site.
echo.
node "%~dp0server.mjs"
if %ERRORLEVEL% NEQ 0 pause
