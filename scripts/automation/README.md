# External automation: Cursor Agent “continue”

Cursor does not expose a supported API to inject chat messages. These scripts **drive the desktop UI** (focus Cursor → paste → Enter). They can paste into the **wrong field** if focus is wrong — use at your own risk.

## Requirements

- **Windows** + **PowerShell 5+**
- **`scripts/continue-once.ps1`** is the canonical script ( **`npm run cursor:auto-once`** calls it by name). It uses **WScript.Shell** only (`AppActivate` + `SendKeys`) — **no `Add-Type` / C#**. `cursor-auto-continue-once.ps1` is a thin wrapper for older links.
- **Node** on PATH (for clipboard refresh via `cursor-worker-continue.cjs`)
- **Cursor** running with a **normal** (non-minimized) window

## One shot (recommended first)

1. Open Agent/Composer and **click inside the chat input** (caret visible).
2. From repo root:

```powershell
.\scripts\continue-once.ps1
```

Optional: try to focus chat first (depends on your keybindings):

```powershell
.\scripts\continue-once.ps1 -PreSendKeys '^l'
```

If clipboard is already correct:

```powershell
.\scripts\continue-once.ps1 -SkipClipboard
```

Or via npm:

```bash
npm run cursor:auto-once
```

## Loop (polling — not “when agent finishes”)

Waits **N seconds** between rounds. If **N** is shorter than the model’s reply time, you will queue duplicate prompts and burn usage.

```powershell
.\scripts\cursor-auto-continue-loop.ps1 -IntervalSeconds 180 -MaxRounds 10
```

- **Ctrl+C** stops the loop.
- **`MaxRounds 0`** = run until you stop (dangerous).

```bash
npm run cursor:auto-loop
```

(Default interval is set inside `package.json` — edit the script args there or run the `.ps1` directly with parameters.)

## Global hotkey (AutoHotkey v2)

1. Install [AutoHotkey v2](https://www.autohotkey.com/).
2. Edit `cursor-continue-hotkey.ahk` if your repo path is not next to the script (defaults derive from script location).
3. Double-click the `.ahk` to run; **Ctrl+Alt+F9** runs one continue.

## npm scripts (optional args)

PowerShell on Windows only. To pass parameters, call the `.ps1` directly.

| Script | Command |
|--------|---------|
| Once | `npm run cursor:auto-once` |
| Loop | `npm run cursor:auto-loop` (see `package.json` for default `-IntervalSeconds`) |

## Linux (manual pattern)

Rough equivalent with `xdotool` (you must install it and adjust window/class names):

```bash
npm run cursor:continue
xdotool search --name 'Cursor' windowactivate
sleep 0.5
xdotool key ctrl+v
xdotool key Return
```

## Safety

- **Do not** leave an aggressive loop unattended.
- **Trust** that the focused window is Cursor before running.
- Prefer **long** `-IntervalSeconds` and a **low** `-MaxRounds` until you trust the timing.
