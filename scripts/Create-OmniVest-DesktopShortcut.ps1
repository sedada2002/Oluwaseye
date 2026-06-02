$ErrorActionPreference = "Stop"

$Workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$DesktopShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "OmniVest Local Test.lnk"
$StartupShortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "OmniVest Local Test KeepAlive.lnk"
$TargetPath = Join-Path $Workspace "scripts\Open-OmniVest.cmd"
$KeepAliveTargetPath = Join-Path $Workspace "scripts\OmniVest-KeepAlive.cmd"
$IconPath = Join-Path $Workspace ".tools\node\node.exe"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($DesktopShortcutPath)
$shortcut.TargetPath = $TargetPath
$shortcut.WorkingDirectory = $Workspace
$shortcut.Description = "Start OmniVest local test harness and open the dashboard."
$shortcut.IconLocation = "$IconPath,0"
$shortcut.Save()

$startupShortcut = $shell.CreateShortcut($StartupShortcutPath)
$startupShortcut.TargetPath = $KeepAliveTargetPath
$startupShortcut.WorkingDirectory = $Workspace
$startupShortcut.Description = "Keep the OmniVest local test harness available after Windows login."
$startupShortcut.IconLocation = "$IconPath,0"
$startupShortcut.Save()

Write-Host "Created desktop shortcut: $DesktopShortcutPath"
Write-Host "Created startup keep-alive shortcut: $StartupShortcutPath"
