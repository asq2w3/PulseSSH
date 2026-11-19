@echo off
title PulseSSH Monitor
cd /d "%~dp0"

echo [1/2] Starting server at http://localhost:9999 ...
start "" "http://localhost:9999"

echo [2/2] Running PulseSSH background collector...
echo ====================================================
echo   PulseSSH Server Monitor is running!
echo   Close this window to stop monitoring.
echo ====================================================
echo.

npm run dev
