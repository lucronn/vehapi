---
trigger: always_on
description: Every agent must read PROJECT.md first and keep it current after any meaningful change.
---

# PROJECT.md — Mandatory Source of Truth

`PROJECT.md` at the repo root is the single authoritative document for this project.
**Every agent must read it before making any code change.**

## On Every Task — Before Writing Code

1. Read `PROJECT.md` in full (or re-read the relevant sections).
2. Check Section 6 (Active TODO) and Section 7 (Known Bugs) for context on the task.
3. Verify the task does not violate Section 4 (Architecture Rules).

## After Completing Any Meaningful Work

Update `PROJECT.md` to reflect the new state. Specifically:

### Section 5 — Current Status
- Flip `⚠️` → `✅` for anything newly completed.
- Add `🔄` for anything newly in-progress.
- Add new subsections if a new major area is introduced.

### Section 6 — Active TODO
- Remove items you completed.
- Add new items you discovered (with correct priority: 🔴/🟠/🟡/🟢 and owner: Agent/Operator).
- If a TODO becomes blocked or changes scope, update its description.

### Section 7 — Known Bugs
- Add any new bugs you discover (status, description, file:line).
- Change status to `✅ Fixed` and remove after the fix is committed.

### Section 8 — Completed
- Prepend a new row: `| YYYY-MM-DD | Brief description of what changed |`
- Keep the table sorted newest-first.

### Other Sections
- Section 2 (Infrastructure): update if infra changes.
- Section 10 (Blueprint): update if a key flow changes.
- Section 12 (File Ownership): update if new canonical files are created.
- Section 13 (Environment Variables): update if new env vars are required.

## Also Update PROGRESS.md

`PROGRESS.md` is the detailed append-only change log. Add a new entry at the top:
```
**Last updated**: YYYY-MM-DD — **Short title:**
One paragraph describing what changed, what was fixed, and current state.
```

## Hard Rules

- **Never reference Supabase, Vercel, or Netlify** in new code or docs — they are decommissioned.
- **Never call Motor API from `src/`** (Angular frontend) — backend proxy only.
- **Never create `NgModule`** in Angular code.
- **Always run `npx tsc --noEmit`** after TypeScript changes before declaring done.
- **Always run `node --check <file>`** after backend JS changes before declaring done.
- **Every commit must be pushed immediately** — never leave commits unpushed, regardless of whether the change is code or docs.
- **Doc updates ship with the commit** — `PROJECT.md` and `PROGRESS.md` must be updated and included in the same push as the code change that prompted them.
