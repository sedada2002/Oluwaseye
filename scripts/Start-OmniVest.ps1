param(
  [int]$Port = 4174,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$Workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$NodeDir = Join-Path $Workspace ".tools\node"
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCmd = Join-Path $NodeDir "npm.cmd"
$ServerEntry = Join-Path $Workspace "dist\dev\mockServer.js"
$PidFile = Join-Path $Workspace ".tools\omnivest-test-server.pid"
$OutLog = Join-Path $Workspace ".tools\omnivest-test-server.out.log"
$ErrLog = Join-Path $Workspace ".tools\omnivest-test-server.err.log"
$Url = "http://127.0.0.1:$Port/"
$HealthUrl = "http://127.0.0.1:$Port/api/health"

function Test-OmniVestHealth {
  param([string]$Uri)

  try {
    $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 2
    return ($response.ok -eq $true -and $response.service -eq "omnivest-local-test-harness")
  } catch {
    return $false
  }
}

function Stop-StaleOmniVestProcess {
  if (-not (Test-Path -LiteralPath $PidFile)) {
    return
  }

  $rawPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $rawPid) {
    return
  }

  $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  if ($process -and -not (Test-OmniVestHealth -Uri $HealthUrl)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $NodeExe) -or -not (Test-Path -LiteralPath $NpmCmd)) {
  throw "Portable Node/npm runtime was not found under $NodeDir. Run npm installation setup again before starting OmniVest."
}

New-Item -ItemType Directory -Force -Path (Join-Path $Workspace ".tools") | Out-Null
$env:PATH = "$NodeDir;$env:PATH"

if (Test-OmniVestHealth -Uri $HealthUrl) {
  Write-Host "OmniVest is already running at $Url"
  if (-not $NoBrowser) {
    Start-Process $Url
  }
  exit 0
}

Stop-StaleOmniVestProcess

Push-Location $Workspace
try {
  & $NpmCmd run build:emit
  if ($LASTEXITCODE -ne 0) {
    throw "TypeScript emit build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $ServerEntry)) {
  throw "Compiled server entry was not found at $ServerEntry."
}

Push-Location $Workspace
try {
  $innerCommand = "`"$NodeExe`" `"$ServerEntry`" --port=$Port > `"$OutLog`" 2> `"$ErrLog`""
  & $env:ComSpec /d /c start "OmniVest Local Test Server" /min cmd.exe /d /s /c $innerCommand
} finally {
  Pop-Location
}

$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  if (Test-OmniVestHealth -Uri $HealthUrl) {
    $connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
      Where-Object { $_.State -eq "Listen" } |
      Select-Object -First 1
    if ($connection) {
      Set-Content -LiteralPath $PidFile -Value $connection.OwningProcess
    }
    Write-Host "OmniVest is running at $Url"
    if (-not $NoBrowser) {
      Start-Process $Url
    }
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

throw "OmniVest did not become healthy on $HealthUrl. Check $OutLog and $ErrLog."
