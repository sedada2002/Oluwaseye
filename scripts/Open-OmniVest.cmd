@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "URL=http://127.0.0.1:4174/"
powershell.exe -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:4174/api/health' -TimeoutSec 2; if ($r.ok -eq $true -and $r.service -eq 'omnivest-local-test-harness') { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  start "OmniVest Server" /min "%SCRIPT_DIR%Run-OmniVest-Server.cmd"
  powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(30); while ((Get-Date) -lt $deadline) { try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:4174/api/health' -TimeoutSec 2; if ($r.ok -eq $true -and $r.service -eq 'omnivest-local-test-harness') { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"
  if errorlevel 1 (
    echo OmniVest did not start on http://127.0.0.1:4174/
    echo Check the OmniVest Server window for build or runtime errors.
    pause
    exit /b 1
  )
)
start "" "%URL%"
endlocal
