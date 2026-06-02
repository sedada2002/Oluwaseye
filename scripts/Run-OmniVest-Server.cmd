@echo off
setlocal
set "WORKSPACE=%~dp0.."
cd /d "%WORKSPACE%"
set "PATH=%WORKSPACE%\.tools\node;%PATH%"
call ".tools\node\npm.cmd" run build:emit
if errorlevel 1 (
  echo Build failed. Press any key to exit.
  pause >nul
  exit /b 1
)
".tools\node\node.exe" "dist\dev\mockServer.js" --port=4174
endlocal
