<#
.SYNOPSIS
  Poll: every N seconds, run continue-once.ps1 (clipboard + paste + Enter).

.DESCRIPTION
  Time-based, not "when agent finishes" — tune -IntervalSeconds to your model + task length.
  DANGER: Can spam the agent and spend credits if the interval is too short. Stop with Ctrl+C.

.PARAMETER IntervalSeconds
  Wait after each paste+Enter before the next round (default 120).

.PARAMETER MaxRounds
  Stop after this many rounds; 0 = unlimited until Ctrl+C.

.PARAMETER PreSendKeys
  Passed through to once.ps1 (e.g. '^l' to try to focus chat).

.EXAMPLE
  .\scripts\cursor-auto-continue-loop.ps1 -IntervalSeconds 180 -MaxRounds 5
#>
param(
    [int]$IntervalSeconds = 120,
    [int]$MaxRounds = 0,
    [string]$PreSendKeys = ''
)

$once = Join-Path $PSScriptRoot 'continue-once.ps1'
$round = 0

while ($true) {
    $round++
    Write-Host "=== Round $round @ $(Get-Date -Format o) ===" -ForegroundColor Cyan
    if ($PreSendKeys) {
        & $once -PreSendKeys $PreSendKeys
    }
    else {
        & $once
    }

    if ($MaxRounds -gt 0 -and $round -ge $MaxRounds) {
        Write-Host "Stopped after $MaxRounds rounds."
        break
    }

    Write-Host "Waiting $IntervalSeconds s... (Ctrl+C to stop)" -ForegroundColor DarkGray
    Start-Sleep -Seconds $IntervalSeconds
}
