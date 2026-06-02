param(
  [int]$Port = 4280
)

$ErrorActionPreference = "Stop"

$Workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$PidFile = Join-Path $Workspace ".tools\ai-consulting-server.pid"

$pids = @()
if (Test-Path -LiteralPath $PidFile) {
  $rawPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($rawPid) {
    $pids += [int]$rawPid
  }
}

$connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq "Listen" }
foreach ($connection in $connections) {
  $pids += $connection.OwningProcess
}

$pids = $pids | Sort-Object -Unique
foreach ($processId in $pids) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Write-Host "Stopped AI Consulting Firm OS on port $Port."
