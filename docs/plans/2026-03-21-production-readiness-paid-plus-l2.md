# Production readiness (paid v1 + L2 complete) implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a production-ready Torque: Track A (rate limits, observability, RLS review, deploy verification) and Track B (L2 RAG **query** API + Angular consumption + `media_asset` wiring per existing migrations), with mobile and desktop golden-path validation.

**Architecture:** Keep all privileged DB and embedding operations in **vehapiproxi**; Angular calls `/api/*` only. L2 **ingest** stays in `background_worker.js` + `l2_rag_ingest.js`; add **read** path via new route module that runs pgvector queries using Supabase service role server-side. Gate risky UI with env-driven feature flags.

**Tech Stack:** Angular 19, Express (vehapiproxi), Supabase (PostgreSQL + pgvector), Stripe, NVIDIA/OpenAI-compatible embeddings (`embedding_client.js`), GitHub Actions → Vercel.

**Prerequisites:** Branch off `main` in a **git worktree** (see superpowers:using-git-worktrees). Do not implement directly on `main` without explicit approval.

**Reference docs:** `docs/plans/2026-03-21-production-readiness-paid-plus-l2-design.md`, `docs/plans/2026-03-18-normalization-schema-design.md`, `AGENTS.md`, `documentation/DEPLOYMENT.md`, `PROGRESS.md`.

---

### Task 1: Baseline — deploy state and “pending deploy” verification

**Files:**
- Read: `PROGRESS.md` (Bugs & Known Issues, What’s Left)
- Read: `.github/workflows/deploy.yml`, `.github/workflows/deploy-backend.yml`
- Read: `documentation/DEPLOYMENT.md`

**Step 1:** List every item under **Bugs & Known Issues** that is marked **pending deploy** or **Hardened (pending deploy)**.

**Step 2:** For each, confirm the fixing commit exists on `main` (or your release branch) and note the **first production deploy** that contains it (Vercel deployment id or date).

**Step 3:** Run local smoke (developer machine): `npm run build` at repo root; `cd vehapiproxi && node -c src/index.js` or start `node src/index.js` and hit health if present.

**Step 4:** Document results in a short section at the bottom of `PROGRESS.md` **or** in the PR description (table: issue → fix → verified Y/N).

**Step 5:** Commit

```bash
git add PROGRESS.md
git commit -m "docs: record deploy verification baseline for production readiness"
```

---

### Task 2: Rate limiting — article content and hot proxy routes

**Files:**
- Modify: `vehapiproxi/package.json` (if new dependency, e.g. `express-rate-limit`)
- Modify: `vehapiproxi/src/function.js` (mount limiter on `/api` subtree for article content routes)
- Create: `vehapiproxi/src/rate_limit.js` (optional factory for shared limiters)

**Step 1:** Add dependency (if not present):

```bash
cd vehapiproxi
npm install express-rate-limit
```

**Step 2:** Write a **failing** characterization: manual or small script under `vehapiproxi/scripts/` that hammers `GET` article content route locally and expects **429** after N requests — or unit-test the limiter factory if you extract pure config.

**Step 3:** Implement **per-IP** (and optionally per-user when JWT present) limiter for routes matching article HTML/content proxy paths (narrow scope — do not throttle entire `/api`).

**Step 4:** Run script / manual test: first requests **200**, after threshold **429** with `Retry-After` if configured.

**Step 5:** Document env vars in `vehapiproxi/.env.example` (e.g. `ARTICLE_RATE_LIMIT_WINDOW_MS`, `ARTICLE_RATE_LIMIT_MAX`).

**Step 6:** Commit

```bash
git add vehapiproxi/package.json vehapiproxi/package-lock.json vehapiproxi/src/function.js vehapiproxi/src/rate_limit.js vehapiproxi/.env.example vehapiproxi/scripts/
git commit -m "feat(proxy): rate limit article content routes"
```

---

### Task 3: Observability — structured errors and alert hooks

**Files:**
- Modify: `vehapiproxi/src/logger.js` or `vehapiproxi/src/function.js` (global error handler)
- Read: `randdev/LOGGING.md` (if applicable)

**Step 1:** Ensure Express error middleware logs **route**, **status**, **user id** (if available), and **correlation id** (generate per request if missing).

**Step 2:** Add log lines at Stripe webhook handler failures and worker-fatal paths (if not already).

**Step 3:** Document in `documentation/DEPLOYMENT.md` how to wire logs to your host (Vercel log drains / external APM) — even if only a placeholder section with “export JSON logs”.

**Step 4:** Commit

```bash
git add vehapiproxi/src/function.js vehapiproxi/src/logger.js documentation/DEPLOYMENT.md
git commit -m "chore(proxy): improve error logging for production ops"
```

---

### Task 4: RLS review — staging Supabase

**Files:**
- Read: `supabase_schema.sql` (policies section)
- Create: `documentation/migrations/YYYYMMDD_rls_tightening.sql` (additive; do not drop tables)

**Step 1:** In **staging** project only, enumerate tables with permissive policies.

**Step 2:** Draft tightened policies for `users`, `transactions`, `articles`, and any table exposed to anon/authenticated clients that should be server-only.

**Step 3:** Apply migration on staging; run app + worker smoke (`npm run verify:evidence-links` with staging creds per `PROGRESS.md`).

**Step 4:** Document rollback SQL in the same migration file as comments.

**Step 5:** Commit migration + short `documentation/RLS_STAGING_NOTES.md` (optional).

```bash
git add documentation/migrations/ documentation/RLS_STAGING_NOTES.md
git commit -m "security(supabase): tighten RLS policies (staging migration)"
```

---

### Task 5: L2 retrieval API — pgvector query in vehapiproxi

**Files:**
- Read: `vehapiproxi/src/supabase.js` (`content_chunk` helpers)
- Read: `vehapiproxi/src/embedding_client.js`
- Read: `documentation/migrations/20260324_l2_content_chunk_pgvector.sql`
- Create: `vehapiproxi/src/l2_retrieval.js` (embed query string + RPC or raw SQL via supabase-js)
- Modify: `vehapiproxi/src/function.js` (register `POST /api/vehicle/:id/l2/search` or similar)
- Modify: `src/services/motor-api.service.ts` (Angular client method)

**Step 1:** Confirm `content_chunk` columns: embedding type, FK to `content_item`, indexes — match query filter (`vehicle_id` / `content_item_id`).

**Step 2:** Implement server-only flow: **embed** user query via `embedTextsBatch`, **select** nearest chunks with `.rpc()` or PostgREST filter if you add a SQL function `match_content_chunks(vehicle_id, query_embedding, match_count)`.

**Step 3:** Return JSON: `{ chunks: [{ text, content_item_id, score, citation }] }` — citations must map to L1 ids per design doc.

**Step 4:** Protect with same auth as other vehicle-scoped routes (Bearer + credits/unlock rules as appropriate).

**Step 5:** Manual test with curl + valid JWT against local proxy.

**Step 6:** Commit

```bash
git add vehapiproxi/src/l2_retrieval.js vehapiproxi/src/function.js vehapiproxi/src/supabase.js src/services/motor-api.service.ts
git commit -m "feat(api): L2 vector search endpoint for vehicle-scoped RAG"
```

---

### Task 6: Angular — L2 search UI (feature-flagged)

**Files:**
- Modify: `src/environments/environment.ts`, `src/environments/environment.prod.ts` (e.g. `features.l2Search`)
- Create or modify: a panel under `src/pages/` or `src/components/` on `VehicleDashboardComponent` template

**Step 1:** Add `features.l2Search` default **false** in prod until QA passes.

**Step 2:** When enabled, show search input + results list (chunk text + link to article if `content_item_id` resolves).

**Step 3:** Mobile: full-width stack; Desktop: optional side panel — reuse existing design tokens from `src/styles.css`.

**Step 4:** Commit

```bash
git add src/environments/environment.ts src/environments/environment.prod.ts src/pages/ src/components/
git commit -m "feat(ui): optional L2 search panel on vehicle dashboard"
```

---

### Task 7: `media_asset` — ingest/query stubs to completion

**Files:**
- Read: `documentation/migrations/20260324_l2_content_chunk_pgvector.sql` (media_asset section)
- Modify: `vehapiproxi/src/background_worker.js` (write `media_asset` row when graphic/PDF ingested)
- Modify: `vehapiproxi/src/supabase.js` (upsert helpers)

**Step 1:** Define minimal row shape (vehicle_id, motor_ref, mime_type, storage path or hash).

**Step 2:** Implement insert on successful graphic fetch path (proxy or worker — wherever binary is first persisted).

**Step 3:** Add read API only if UI needs it in v1; otherwise document “write path complete, read in Task 6 follow-up”.

**Step 4:** Commit

```bash
git add vehapiproxi/src/background_worker.js vehapiproxi/src/supabase.js
git commit -m "feat(worker): persist media_asset metadata during ingest"
```

---

### Task 8: Golden paths — mobile + desktop checklist

**Files:**
- Create: `documentation/RELEASE_CHECKLIST.md` (short)

**Step 1:** Write checklist: login, buy credits (Stripe test), unlock article, open article, run L2 search (if flag on) — repeat with browser width < 480px and > 1280px.

**Step 2:** Run `cd vehapiproxi && npm run verify:evidence-links -- --local` (or documented variant) after worker changes.

**Step 3:** Update `PROGRESS.md` — toggle checklist items if your repo mirrors Section 23, or add **Production readiness** subsection with links to this plan.

**Step 4:** Commit

```bash
git add documentation/RELEASE_CHECKLIST.md PROGRESS.md
git commit -m "docs: release checklist for paid v1 + L2 GA"
```

---

## Execution handoff

**Plan complete and saved to `docs/plans/2026-03-21-production-readiness-paid-plus-l2.md`. Two execution options:**

1. **Subagent-driven (this session)** — Fresh subagent per task, spec review + quality review after each; use superpowers:subagent-driven-development; **serialize** implementers (no parallel implementers on same branch).

2. **Parallel session** — New chat in a **worktree**; use superpowers:executing-plans in batches of ~3 tasks; report between batches.

**Which approach?** (User or implementing agent chooses before coding.)

---

## Verification before “done”

Use superpowers:verification-before-completion: `npm run build`, backend start smoke, Stripe test mode flow, L2 search curl test, and checklist in `documentation/RELEASE_CHECKLIST.md`.
