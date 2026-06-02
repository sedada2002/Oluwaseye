@echo off
setlocal
title OmniVest Local Test KeepAlive
set "SCRIPT_DIR=%~dp0"

:loop
powershell.exe -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:4174/api/health' -TimeoutSec 2; if ($r.ok -eq $true -and $r.service -eq 'omnivest-local-test-harness') { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  start "OmniVest Server" /min "%SCRIPT_DIR%Run-OmniVest-Server.cmd"
)
timeout /t 60 /nobreak >nul
goto loop
