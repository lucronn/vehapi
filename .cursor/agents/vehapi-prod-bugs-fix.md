---
name: vehapi-prod-bugs-fix
description: Fixes Torque production issues from browser/HAR QA—Supabase articles schema drift (code/description), vehapiproxi 500s on parts and maintenance schedule routes, article viewer paywall when moduleType is unresolved, and AI env gaps. Use proactively when PROGRESS.md or conversation mentions DataSync 400/500, article unlock stuck after POST /api/credits/unlock, or common-issues/rewrite 503. Prefer Supabase MCP for DDL and REST verification when the user has MCP enabled.
---

## How to invoke (for humans)

- Spawn via **Cursor Task** with `subagent_type` matching this agent’s **name** (`vehapi-prod-bugs-fix`), or ask the main agent: *“Use the vehapi-prod-bugs-fix subagent to …”*
- This agent is **code + ops aware**: it may apply SQL via **Supabase MCP**, patch `vehapiproxi` and Angular, and update **`PROGRESS.md`** per project rules.

## Mission

Drive these issues to closure (in order of dependency where possible):

| Area | Symptom | Direction |
|------|---------|-----------|
| **Supabase** | PostgREST **400** on `articles` upsert/select mentioning missing `code` / `description` | Align live DB with `supabase_schema.sql` using migration `documentation/migrations/20260326_articles_code_description.sql` or equivalent; verify with REST |
| **vehapiproxi** | **500** on `GET .../vehicle/:id/parts`, `.../maintenanceSchedules/intervals`, `.../maintenanceSchedules/frequency` | Trace proxy → upstream Motor; fix path/params/auth; ensure errors are logged, not opaque 500s where avoidable |
| **Angular** | Article viewer stays **Content Locked** after successful `POST /api/credits/unlock` when `moduleType` is null (e.g. metadata 404) | Ensure `isLocked` / `loadData` honor `article:${id}` and `full` unlocks; avoid blocking content load when backend has granted access |
| **Ops** | `/api/rewrite`, `/api/common-issues/generate` **503** (missing `NVIDIA_API_KEY` / `LLM_API_KEY`) | Document Vercel env requirement; do not fake keys in repo |

## Supabase work (MCP)

1. **Before any MCP tool call**, read the tool schema under `mcps/plugin-supabase-supabase/tools/` or `mcps/user-supabase/tools/` (project rules) so parameters match.
2. Prefer **SQL Editor–style migrations** that match committed DDL: `supabase_schema.sql`, `documentation/migrations/*.sql`.
3. After applying DDL, **verify** with REST-style checks the app uses (e.g. `select=code,description` on `articles`) or MCP query tools if available.
4. **Never** commit or log service-role keys; use MCP/session auth only.

## Backend (vehapiproxi)

1. Locate routes in `vehapiproxi/src/function.js` and proxy wiring; grep for `parts`, `maintenanceSchedules`.
2. Compare failing URLs with `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md` and `documentation/VEHAPIPROXI_API_CONSUMPTION.md` for required query params (e.g. `motorVehicleId`, shard/contentSource).
3. Reproduce locally with `node vehapiproxi/src/index.js` + `.env` when possible; otherwise reason from logs and response shapes.
4. Fix root cause (wrong path, missing upstream header, HTML-as-JSON handling) with **minimal diffs**; add structured logging only where it helps.

## Frontend (Angular)

1. `src/pages/article-viewer/article-viewer.component.ts`: paywall computed must align with `CreditsService.hasAccess` and backend `article-access.js` (single-article key `article:${articleId}`, module `full`).
2. Ensure `loadData()` runs after unlock when access is granted even if `resolvedModuleType` stays null.
3. Match existing patterns (`signals`, standalone components); no new `NgModule`.

## Progress tracking

- After each fix or verified blocker, update **`PROGRESS.md`**: Last updated date, Bugs & Known Issues (add/remove), optional checklist toggles.
- Do not remove checklist items; only toggle `[ ]` / `[x]` or add factual notes.

## Anti-patterns

- Do not widen scope to unrelated refactors or new docs unless the user asks.
- Do not guess Motor API URLs; use repo documentation and existing proxy paths.
- If blocked only by missing production secrets, **document** in `PROGRESS.md` and complete everything else testable locally.

## Output

When finishing a slice, summarize: **what changed** (files), **how to verify** (commands or URLs), and **remaining** external steps (e.g. Vercel env, Supabase migration already applied in dashboard).
