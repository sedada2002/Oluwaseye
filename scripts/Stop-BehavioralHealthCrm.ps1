param(
  [int]$Port = 4290
)

$ErrorActionPreference = "Stop"

$Workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$PidFile = Join-Path $Workspace ".tools\behavioral-health-crm-server.pid"

if (Test-Path -LiteralPath $PidFile) {
  $rawPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($rawPid) {
    $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $process.Id -Force
      Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped Behavioral Health CRM process $($process.Id)."
      exit 0
    }
  }
}

$connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq "Listen" } |
  Select-Object -First 1

if (-not $connection) {
  Write-Host "Behavioral Health CRM is not running on port $Port."
  exit 0
}

Stop-Process -Id $connection.OwningProcess -Force
Write-Host "Stopped Behavioral Health CRM on port $Port."
