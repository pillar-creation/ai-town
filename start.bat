@echo off
setlocal
cd /d "%~dp0"
title AI Town

echo Starting AI Town...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% neq 0 (
  echo Start failed with exit code %EXITCODE%.
) else (
  echo Dev processes exited.
)
pause
exit /b %EXITCODE%
