<#
.SYNOPSIS
  External automation: refresh continue prompt on clipboard, focus Cursor, paste, Enter.

.DESCRIPTION
  Uses Win32 + WScript.Shell SendKeys. No Cursor API — fragile if UI/focus changes.
  Put the caret in the Agent/Composer input before running, or pass -PreSendKeys to try to focus chat.

.PARAMETER SkipClipboard
  Do not run node cursor-worker-continue.cjs (use whatever is already on the clipboard).

.PARAMETER PreSendKeys
  Optional SendKeys snippet before paste, e.g. '^l' (Ctrl+L) or '{TAB}' — depends on your Cursor keybindings.

.EXAMPLE
  .\scripts\cursor-auto-continue-once.ps1
.EXAMPLE
  .\scripts\cursor-auto-continue-once.ps1 -PreSendKeys '^l'
#>
param(
    [switch]$SkipClipboard,
    [string]$PreSendKeys = '',
    [int]$PostActivateDelayMs = 450,
    [int]$AfterPasteDelayMs = 180
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Add-Type -Namespace CursorAuto -Name Native -MemberDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Native {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@

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

[void][CursorAuto.Native]::ShowWindowAsync($proc.MainWindowHandle, 9)
[void][CursorAuto.Native]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Milliseconds $PostActivateDelayMs

$wsh = New-Object -ComObject WScript.Shell
if ($PreSendKeys) {
    $wsh.SendKeys($PreSendKeys)
    Start-Sleep -Milliseconds 300
}
$wsh.SendKeys('^v')
Start-Sleep -Milliseconds $AfterPasteDelayMs
$wsh.SendKeys('{ENTER}')

Write-Host 'Sent paste + Enter to Cursor.'
