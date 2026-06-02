$ErrorActionPreference = "Stop"

$Workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$TaskName = "OmniVest Local Test KeepAlive"
$ScriptPath = Join-Path $Workspace "scripts\Start-OmniVest.ps1"
$PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -NoBrowser"
$TriggerAtLogon = New-ScheduledTaskTrigger -AtLogOn
$TriggerRepeating = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($TriggerAtLogon, $TriggerRepeating) -Settings $Settings -Description "Keeps the OmniVest local test harness available on http://127.0.0.1:4174/." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Registered and started scheduled task: $TaskName"
