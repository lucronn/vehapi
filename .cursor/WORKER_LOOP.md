# Worker / agent auto-continue (Cursor hooks)

## Known limitation (read this first)

Per [Cursor Agent hooks docs](https://cursor.com/docs/agent/hooks), **`followup_message` is only documented for `stop` and `subagentStop`**.

- **`afterAgentResponse`** is documented with **input only** (no output schema). Cursor **will run** a script you attach to it, but **`followup_message` on stdout is ignored** — so it **cannot** auto-loop the chat. (That’s why a log file grew but nothing continued.)
- **`stop`** often **does not fire** after each assistant message in current Cursor builds, so `followup_message` from `stop` may never run.
- **`subagentStop`** can still emit `followup_message` when a **Task** subagent finishes — useful for **one** automatic follow-up after e.g. `worker-progress-orchestrator`, not a loop after every main-agent reply.

**Practical workaround — clipboard only:**

```bash
npm run cursor:continue
```

**External desktop automation (Windows):** focus Cursor → paste → Enter on a timer or hotkey. See **`scripts/automation/README.md`** (`cursor-auto-continue-once.ps1`, `cursor-auto-continue-loop.ps1`, optional `cursor-continue-hotkey.ahk`). This is **not** official Cursor support; wrong focus can paste into the wrong control.

---

## What the repo hooks still do

| Hook           | Purpose |
|----------------|---------|
| `sessionStart` | Smoke log `.cursor/hooks/hooks-smoke.log` — proves hooks load |
| `stop`         | If Cursor calls it, `auto-continue.mjs` may emit `followup_message` |
| `subagentStop` | After Task subagents, same script; filters “worker-ish” tasks (orchestrator, PROGRESS, `background_worker`, normalization) |

## Enable / disable (`stop` + `subagentStop`)

- **Default ON** when hooks are installed (no flag required).
- **Opt out:** create `.cursor/worker-loop.disabled` (unless `.cursor/worker-loop.enabled` also exists — then ON).

## Safety caps

- **`loop_limit`**: `null` in `.cursor/hooks.json` for these entries.
- **`VEHAPI_AUTO_CONTINUE_MAX`** (default **200**).
- **`VEHAPI_AUTO_CONTINUE_MESSAGE`**: override text for hook-driven follow-ups and for `npm run cursor:continue`.

## Logs (local, gitignored)

- `.cursor/hooks/hooks-smoke.log` — `sessionStart`
- `.cursor/hooks/auto-continue.log` — every `stop` / `subagentStop` run starts with `INVOKED …`

## Troubleshooting

1. **Workspace trust** — Project hooks require a **trusted** workspace (Command Palette: **Manage Workspace Trust**).
2. **`node` on PATH** — Must be available to Cursor’s hook subprocess.
3. **No `INVOKED` lines** after agent turns → `stop` not firing; use **`npm run cursor:continue`** between turns.

## Files

- `.cursor/hooks.json`
- `.cursor/hooks/auto-continue.mjs`
- `.cursor/hooks/session-start-log.mjs`
- `scripts/cursor-worker-continue.cjs`

## References

- [Cursor docs: Agent hooks](https://cursor.com/docs/agent/hooks)
