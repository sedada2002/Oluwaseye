param(
  [int]$Port = 4290,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$Workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$NodeDir = Join-Path $Workspace ".tools\node"
$PortableNodeExe = Join-Path $NodeDir "node.exe"
$PortableNpmCmd = Join-Path $NodeDir "npm.cmd"
$NodeExe = if (Test-Path -LiteralPath $PortableNodeExe) { $PortableNodeExe } else { "node" }
$NpmCmd = if (Test-Path -LiteralPath $PortableNpmCmd) { $PortableNpmCmd } else { "npm" }
$ServerEntry = Join-Path $Workspace "dist\behavioralHealthCrm\server.js"
$PidFile = Join-Path $Workspace ".tools\behavioral-health-crm-server.pid"
$OutLog = Join-Path $Workspace ".tools\behavioral-health-crm-server.out.log"
$ErrLog = Join-Path $Workspace ".tools\behavioral-health-crm-server.err.log"
$Url = "http://127.0.0.1:$Port/"
$HealthUrl = "http://127.0.0.1:$Port/api/health"

function Test-BehavioralHealthCrmHealth {
  param([string]$Uri)

  try {
    $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 2
    return ($response.ok -eq $true -and $response.service -eq "behavioral-health-crm")
  } catch {
    return $false
  }
}

function Stop-StaleBehavioralHealthCrmProcess {
  if (-not (Test-Path -LiteralPath $PidFile)) {
    return
  }

  $rawPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $rawPid) {
    return
  }

  $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  if ($process -and -not (Test-BehavioralHealthCrmHealth -Uri $HealthUrl)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $Workspace ".tools") | Out-Null

if (Test-BehavioralHealthCrmHealth -Uri $HealthUrl) {
  Write-Host "Behavioral Health CRM is already running at $Url"
  if (-not $NoBrowser) {
    Start-Process $Url
  }
  exit 0
}

Stop-StaleBehavioralHealthCrmProcess

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
  throw "Compiled CRM server entry was not found at $ServerEntry."
}

$commandLine = "`"$NodeExe`" `"$ServerEntry`" --port=$Port"
$processResult = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = $commandLine
  CurrentDirectory = $Workspace
}

if ($processResult.ReturnValue -ne 0) {
  throw "Windows process creation failed with return code $($processResult.ReturnValue)."
}

Set-Content -LiteralPath $PidFile -Value $processResult.ProcessId

$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  if (Test-BehavioralHealthCrmHealth -Uri $HealthUrl) {
    $connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
      Where-Object { $_.State -eq "Listen" } |
      Select-Object -First 1
    if ($connection) {
      Set-Content -LiteralPath $PidFile -Value $connection.OwningProcess
    }
    Write-Host "Behavioral Health CRM is running at $Url"
    if (-not $NoBrowser) {
      Start-Process $Url
    }
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

throw "Behavioral Health CRM did not become healthy on $HealthUrl. Check $OutLog and $ErrLog."
