# Torque — Claude Code Instructions

## First: Read PROJECT.md

**Before any code change, read `PROJECT.md` at the repo root.**
It contains architecture rules, current status, active TODOs, known bugs, and the full project blueprint.
This file (`CLAUDE.md`) contains only Claude-Code-specific behavior on top of `PROJECT.md`.

---

## Mandatory After Every Meaningful Task

### 1. Update PROJECT.md
- **§5 Current Status** — flip ⚠️ → ✅ for completed work; add 🔄 for in-progress
- **§6 Active TODO** — remove completed items; add new ones with priority (🔴/🟠/🟡/🟢) and owner
- **§7 Known Bugs** — add newly discovered bugs with `file:line`; remove fixed ones
- **§8 Completed** — prepend `| YYYY-MM-DD | what changed |`

### 2. Update PROGRESS.md
Prepend at the top:
```
**Last updated**: YYYY-MM-DD — **Title:**
One paragraph: what changed, what was fixed, current state.
```

### 3. Commit and Push
Every commit must be pushed immediately. Never leave commits unpushed.
```bash
git add -p   # stage relevant files only
git commit -m "concise description"
git push
```

---

## Hard Rules

| Rule | Detail |
|------|--------|
| No Supabase / Vercel / Netlify | Decommissioned — never reference in new code or docs |
| No Motor calls from `src/` | Angular frontend uses `/api` proxy only — never `motor.com` directly |
| No `NgModule` | Angular standalone components only |
| TypeScript check | Run `npx tsc --noEmit` after any `.ts` change |
| Backend JS check | Run `node --check <file>` after any `.js` change in `vehapiproxi/src/` |
| No nested subscribe | Use `switchMap` / `mergeMap` for inner observables |
| Push after every doc update | Any change to `PROJECT.md`, `PROGRESS.md`, `CLAUDE.md`, `AGENTS.md`, or `documentation/` must be committed and pushed immediately — never leave doc changes unpushed |
| Signals over state | Use Angular signals for local/sync state; RxJS for async streams |

---

## Local Dev Commands

```bash
# Full ingest stack
cd vehapiproxi && npm run stack

# Angular dev server
npm start

# Type check
npx tsc --noEmit

# Backend syntax check
node --check vehapiproxi/src/index.js
```

---

## Key Files

| What | Where |
|------|-------|
| Source of truth | `PROJECT.md` |
| Change log | `PROGRESS.md` |
| Agent coding guide | `AGENTS.md` |
| DB schema | `cloudsql_schema.sql` |
| Backend entry | `vehapiproxi/src/function.js` |
| Proxy pool | `vehapiproxi/src/proxy-pool.js` |
| Ingest worker | `vehapiproxi/scripts/worker-ingest-vehicles-full.js` |
| Stack launcher | `vehapiproxi/scripts/run-stack.mjs` |
| Angular entry | `index.tsx` |
