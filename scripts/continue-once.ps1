<#
.SYNOPSIS
  External automation: refresh continue prompt on clipboard, focus Cursor, paste, Enter.

.DESCRIPTION
  Canonical implementation (no Add-Type / C#). Uses WScript.Shell AppActivate + SendKeys.
  npm script `cursor:auto-once` invokes THIS file by name so a stale `cursor-auto-continue-once.ps1`
  on disk cannot shadow the real logic.

.PARAMETER SkipClipboard
  Do not run node cursor-worker-continue.cjs (use whatever is already on the clipboard).

.PARAMETER PreSendKeys
  Optional SendKeys snippet before paste, e.g. '^l' (Ctrl+L) or '{TAB}' — depends on your Cursor keybindings.

.EXAMPLE
  .\scripts\continue-once.ps1
.EXAMPLE
  .\scripts\continue-once.ps1 -PreSendKeys '^l'
#>
param(
    [switch]$SkipClipboard,
    [string]$PreSendKeys = '',
    [int]$PostActivateDelayMs = 450,
    [int]$AfterPasteDelayMs = 180
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-CursorWindowProcess {
    Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle } |
        Select-Object -First 1
}

if (-not $SkipClipboard) {
    Push-Location $RepoRoot
    try {
        $node = Get-Command node -ErrorAction Stop
        & $node.Path (Join-Path $RepoRoot 'scripts\cursor-worker-continue.cjs')
    }
    finally {
        Pop-Location
    }
}

$proc = Get-CursorWindowProcess
if (-not $proc) {
    Write-Error 'No Cursor window with a title found. Open the project in Cursor first.'
    exit 1
}

$wsh = New-Object -ComObject WScript.Shell
$activated = $null
try {
    $activated = $wsh.AppActivate([int]$proc.Id)
} catch {
    $activated = $false
}
if (-not $activated) {
    [void]$wsh.AppActivate($proc.MainWindowTitle)
}
Start-Sleep -Milliseconds $PostActivateDelayMs

if ($PreSendKeys) {
    $wsh.SendKeys($PreSendKeys)
    Start-Sleep -Milliseconds 300
}
$wsh.SendKeys('^v')
Start-Sleep -Milliseconds $AfterPasteDelayMs
$wsh.SendKeys('{ENTER}')

Write-Host 'Sent paste + Enter to Cursor.'
