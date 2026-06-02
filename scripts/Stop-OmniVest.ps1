param(
  [int]$Port = 4174
)

$ErrorActionPreference = "Stop"

$Workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$PidFile = Join-Path $Workspace ".tools\omnivest-test-server.pid"

if (-not (Test-Path -LiteralPath $PidFile)) {
  $connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq "Listen" } |
    Select-Object -First 1
  if ($connection) {
    Stop-Process -Id $connection.OwningProcess -Force
    Write-Host "Stopped OmniVest process $($connection.OwningProcess) on port $Port."
  } else {
    Write-Host "No OmniVest PID file found and nothing is listening on port $Port."
  }
  exit 0
}

$rawPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $rawPid) {
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Removed empty OmniVest PID file."
  exit 0
}

$process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $process.Id -Force
  Write-Host "Stopped OmniVest process $($process.Id)."
} else {
  Write-Host "OmniVest process $rawPid was not running."
}

Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
