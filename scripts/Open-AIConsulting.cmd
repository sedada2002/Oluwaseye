@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "URL=http://127.0.0.1:4280/"
powershell.exe -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:4280/api/health' -TimeoutSec 2; if ($r.ok -eq $true -and $r.service -eq 'ai-consulting-firm-os') { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start-AIConsulting.ps1" -NoBrowser
  if errorlevel 1 (
    echo AI Consulting Firm OS did not start on http://127.0.0.1:4280/
    echo Check .tools\ai-consulting-server.out.log and .tools\ai-consulting-server.err.log.
    pause
    exit /b 1
  )
)
start "" "%URL%"
endlocal
