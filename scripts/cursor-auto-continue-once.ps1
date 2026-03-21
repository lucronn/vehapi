<#
.SYNOPSIS
  Delegates to continue-once.ps1 (canonical script). Kept for backward compatibility.

  If you see Add-Type errors here, your copy is corrupted — use scripts\continue-once.ps1 or npm run cursor:auto-once.
#>
param(
    [switch]$SkipClipboard,
    [string]$PreSendKeys = '',
    [int]$PostActivateDelayMs = 450,
    [int]$AfterPasteDelayMs = 180
)
& (Join-Path $PSScriptRoot 'continue-once.ps1') @PSBoundParameters
