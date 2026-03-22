# PROGRESS

**Last updated**: 2026-03-21 — **L2 retrieval API:** `POST /api/vehicle/:vehicleId/l2/search` (legacy `POST /api/l2/search`), response chunks `{ text, content_item_id, score, citation }` (L1 ids in `citation`); Angular `l2Search` + auth interceptor updated. Prior **`npm run plan:prompt` / `npm run plan:tasks`** — assemble subagent prompts from `docs/plans/*.md` + clipboard (`docs/plans/subagent-prompts/README.md`). Prior **`npm run verify:prod-readiness`** (root) — Angular build + `node --check` on proxy/worker/L2/Stripe/rate limit; see `scripts/verify-production-readiness.mjs`, **`documentation/RELEASE_CHECKLIST.md`**. Prior **Tasks 7–8:** PDF **`media_asset`** ingest, release checklist. Prior **Merged to `main`:** Tasks 4–6 from production-readiness plan — **RLS tightening** migration (`documentation/migrations/20260321_rls_staging_tightening.sql` + `RLS_STAGING_NOTES.md`), **L2 RPC** `match_content_chunks` (`20260321_match_content_chunks_rpc.sql`, `npm run migrate:match-content-chunks-rpc`), **POST `/api/l2/search`** (`l2_retrieval.js`, unlock gate), **Angular** L2 panel (`l2-search-panel`, `environment.features.l2Search` — **on in dev, off in prod**). Prior **branch `feat/production-readiness`:** article **rate limits**, correlation ids, Stripe webhook hardening, **DEPLOYMENT.md** observability. Prior: **Production readiness program** documented: `docs/plans/2026-03-21-production-readiness-paid-plus-l2-design.md` + task plan `docs/plans/2026-03-21-production-readiness-paid-plus-l2.md` (paid v1 + L2 retrieval/UI + rate limits + RLS/ops). Prior 2026-03-20 — **`verify:evidence-links`** startup checks match **`auth.js`** (placeholder rejection + URL parse); dotenv order matches **`config.js`** (repo-root `.env` overrides). Prior 2026-03-21 — **Worker:** parse-path article tasks **upsert minimal `content_item`** when missing (unblocks L2 + enrichment); **PGRST205** missing `procedure_tool`/`procedure_part` warns once. Prior: **`verify:evidence-links`** SPA-shell shard probe. Prior: **Article shard:** `getArticleContent` keeps OEM `contentSource` when `motorVehicleId` is set (no longer forces `MOTOR`); `resolveSourceParams` + worker `extractContentSource` preserve casing (`GeneralMotors`). Proxy warns on M1 SPA shell HTML for `/article/` paths. Prior 2026-03-20 — **AI parse hardening:** Zod (`ai_parser_schemas.js`) + procedure self-correction retries, **`failed_extractions`** DLQ, **`p-limit`** on structured Nemotron (`NEMOTRON_STRUCTURED_CONCURRENCY`), token counts in **`ai_processing_logs`** (`migrate:ai-hardening`). **L2** opt-in ingest unchanged. **Evidence verify:** default **`http://localhost:3001`**.

## Summary

| Area | Status |
|------|--------|
| Stripe Integration (Checkout, Portal, Webhooks) | Complete |
| Credits Service (Balance, Unlocks, Transactions) | Complete |
| Section-Level Content Locking | Complete |
| Article-Level Content Locking | Complete |
| UI/UX Copy Cleanup | Complete |
| Lock Overlay UX | Complete |
| Repo Structure Cleanup (`randdev/` + `oldfiles/`) | Complete |
| Data Normalization Pipeline | **In redesign** — greenfield L1+ layers (see `docs/plans/`); **Phase 1 (L0 + catalog)** shipped; cutover TBD |

### Active worker direction (normalization)

- **Shipped:** Phase 1 — `evidence_ingest`, `content_item` upsert + post-parse enrichment (`updateContentItemEnrichment`), catalog path in `vehapiproxi/src/background_worker.js` + `content_item_mapper.js`; `evidence_link` after parse for **procedures** (parent row) **/ dtcs / tsbs** + L1 **`procedure_step`** / **`procedure_tool`** / **`procedure_part`** + **`spec_fact`** when schema present (legacy **`specifications`** → `spec_fact` only); native PDF text (`pdf_native_text.js`) and optional sparse-PDF Nemotron vision (`nemotron_multimodal.js`, `ENABLE_NEMOTRON_PDF_VISION_FALLBACK=true`); `npm run verify:evidence-links`; optional Cursor worker-loop (`hooks.json` → `auto-continue.mjs`, default ON — see `.cursor/WORKER_LOOP.md`).
- **Workspace (git):** `.cursor/WORKER_LOOP.md`, `.cursor/hooks.json`, `.cursor/hooks/*.mjs`, and `.cursor/agents/` may be **untracked** until committed — hooks only run in clones that have them. Loop toggle files (`.cursor/worker-loop.enabled` / `.disabled` / `.after-response`) are **gitignored** when present; default auto-continue is ON once hooks are registered (see `WORKER_LOOP.md`). **Desktop continue (Windows):** root **`npm run cursor:auto-once`** invokes **`scripts/continue-once.ps1`** (paste + Enter); see `scripts/automation/README.md`.
- **Next (code):** L2 **query path** (RAG retrieval API + UI) and **`media_asset`** wiring; parallel domains (wiring diagrams, labor, TSB+DTC depth). L1 **`spec_fact`**, **`maintenance_task`**, **`procedure_step`**, **`procedure_tool`**, **`procedure_part`** + L2 **DDL** + **chunk ingest** (flagged) shipped in repo.
- **Regression:** after `background_worker.js` or evidence mapping changes, run `verify:evidence-links` with local `.env` (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`); no automated CI run without injected secrets — not a product bug.
- **Worker assumption:** L1 tables + RLS follow `supabase_schema.sql`; thread writes from existing parse outputs before expanding ingest sources.

## Implementation Checklist

### Stripe & Credits
- [x] Stripe Checkout flow (backend + frontend)
- [x] Webhook handling for `checkout.session.completed`
- [x] Billing portal (payment methods, invoices)
- [x] Session verification after redirect
- [x] Credits balance & unlocks persistence (Supabase)
- [x] Transaction history
- [x] Credit pack purchase UI (1000/2500/5000)

### Content Access Control
- [x] Section-level locking (blur + overlay) on all sections
- [x] Article viewer access gating via `moduleType` input/query param
- [x] All section components propagate `moduleType` when opening articles
- [x] Component-locations module type aligned to `diagrams` (was mismatched)
- [x] Article titles visible before purchase (all titles shown when locked; users can selectively unlock)
- [x] Direct URL access to articles is blocked (missing moduleType → locked; sidebar/browse-all pass moduleType)
- [x] Backend verifies article access (Bearer token + Supabase bucket lookup + unlock check)
- [x] Article lock overlay: Back to Dashboard closes modal in window mode; Refresh button; Unlock single article (100 credits)
- [x] Payments in modal: Get Credits opens credits modal; Stripe checkout in popup (no page refresh)

### UI/UX Cleanup
- [x] Removed verbose marketing copy from home page
- [x] Removed fluff section labels from dashboard (Tactical Overview, Intelligence, etc.)
- [x] Tightened lock overlay descriptions to concise one-liners
- [x] Simplified credits dashboard text (pack descriptions, billing portal, empty states)
- [x] Removed alert()/confirm() dialogs from unlock flows
- [x] Removed internal status badges (Supabase Cached, Connected, version number)
- [x] Cleaned up sidebar and mobile nav labels
- [x] Removed redundant sign-in prompt from credits dashboard (header already has auth)
- [x] Consolidated credits tabs: merged Buy into Overview
- [x] Vehicle dashboard: mobile nav as bottom sheet, Home/Account in header, dynamic bottom tabs
- [x] Navigation tree: shared CategoryTreeComponent in sidebar (desktop) and mobile menu; article catalog visible before purchase
- [x] Fixed vehicle selection dropdown: no more flash/second-click (ignoreNextDocumentClick, keep open during Year load)
- [x] Desktop: Home link in sidebar header, modals use design tokens, Escape to close
- [x] Desktop UI/UX: Full section nav in sidebar (DTCs, TSBs, procedures, diagrams, specs, parts, maintenance, browse-all); wider content (xl/2xl); sidebar xl:w-72; overview grid xl:5 cols; credits pack grid xl:4 cols; window component design tokens; torque-dark/purple in tailwind

## Bugs & Known Issues

- **Fixed 2026-03-18**: Motor/Article API 401 Unauthorized while logged in — interceptor previously forwarded Supabase `Authorization: Bearer ...` to Motor-proxy endpoints (years/catalog/parts/name), causing Motor to reject requests; now only attaches Bearer for `/api/credits/*` and `/api/source/*/vehicle/*/article/*` paths.
- **Fixed 2026-03-19**: Stripe redirect credit authorization sometimes failed due to Supabase session hydration race; `AuthService.getIdToken()` now always hydrates `_session/_user` signals, and `CreditsService.verifySession()` waits for `authService.user()` before calling `/api/credits/verify-session`.
- **Fixed (pending deploy)**: Motor.com session/auth breaks after buying/unlocking a single article — proxy forwarded Supabase `Authorization` header to Motor.com for article requests; backend now strips `Authorization` header in `vehapiproxi/src/function.js` `onProxyReq` before forwarding upstream.
- **Fixed 2026-03-19**: Unauthenticated requests (cookies cleared) could still retrieve cached article content — `articleAccessMiddleware` was matching the wrong path shape because it expected `/api/source/...` even though it runs under `app.use('/api', ...)` (now correctly enforces `/source/...`).
- **Fixed 2026-03-19**: Hardened `articleContentCacheMiddleware` to only cache/serve the exact article-content route (not `/article/:id/title` or other sub-routes), preventing cached HTML leakage on unauthenticated calls.
- **Fixed 2026-03-19**: Reordered backend unlock checks so individually purchased articles (`article:${articleId}`) and `full` unlocks are honored even if article bucket metadata is missing/unmappable.
- **Hardened (pending deploy)**: Ensure no Motor.com auth artifacts leak past the proxy — proxy response header stripping includes `Authorization`/`WWW-Authenticate` and removes `access-control-allow-credentials`.
- **Fixed (pending deploy)**: Backend `vehapiproxi` was not deploying independently after Mar 13; added `deploy-backend.yml` to deploy backend when `vehapiproxi/**` changes.
- **Fixed 2026-03-19**: Vercel serverless cold-start crash from duplicated route module bodies (`vehapiproxi/src/routes/ai-endpoints.js`, `auth.js`, `credits-endpoints.js`) causing duplicate declaration parse errors; deduped modules and moved common-issues generation to lazy `getAiFunctions()` loading.
- **Fixed 2026-03-20**: GitHub Actions/Vercel deploys failing at build (`Cannot find module scripts/inject-eruda.cjs`) after repo cleanup moved scripts; root `package.json` build now calls `randdev/scripts/inject-eruda.cjs`.
- **Hardened 2026-03-20**: GitHub Actions workflows (`deploy.yml`, `deploy-backend.yml`) now set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to preempt Node 20 action-runtime deprecation rollout.

## What's Left to Do

| Priority | Task |
|----------|------|
| **High** | **Apply DB migrations on staging/prod** when not yet applied: `migrate:rls-tightening`, `migrate:match-content-chunks-rpc`. **Prod:** enable `environment.features.l2Search` when QA passes. **Local verify:** `npm run verify:prod-readiness`. **Done in repo:** plan completion table in `docs/plans/2026-03-21-production-readiness-paid-plus-l2.md`. |
| Medium | Phase-1 worker regression: `cd vehapiproxi && npm run verify:evidence-links -- --local --vehicle=<id>` with **local** `ng serve` + `node src/index.js`, `SKIP_ARTICLE_ACCESS_AUTH=true` + `NODE_ENV=development` in `vehapiproxi/.env` (no user JWT). Or Vercel: `--token=<user access_token>`. Needs `SUPABASE_*` in `.env`. |
| Low | Commit `.cursor/hooks.json`, `.cursor/hooks/*.mjs`, `.cursor/WORKER_LOOP.md` (and `.cursor/agents/*`) when the team should share Cursor auto-continue / orchestrator docs |
| Low | (cleared 2026-03-24) AGENTS.md ↔ WORKER_LOOP: hook toggles + `npm run cursor:auto-once` / `continue-once.ps1` documented |
| Low | Full-vehicle unlock option from lock overlay |

## Vehicle data normalization / migration

### Completed

- [x] **normalized_schema.ts** – NormalizedArticle added (all Motor API catalog fields). NormalizedVehicle has is_normalized. Existing interfaces unchanged.
- [x] **supabase_schema.sql** – Articles table: added code, description, sort, bulletin_number, release_date columns + parent_bucket index. Migration SQL included.
- [x] **supabase.js** – ensureVehicleExists (FK safety), markVehicleNormalized, checkArticleContent (articles table cache). `UPSERT_CONFLICT_COLUMNS` extended for L1 tables (`spec_fact`, `maintenance_task`, etc.); helpers for evidence + procedure deletes.
- [x] **background_worker.js** – Creates vehicle record before FK-dependent inserts. Articles include all Motor API fields (code, description, sort, bulletin_number, release_date). Marks vehicle normalized after catalog ingest. extractExternalId returns per-article IDs for DTCs/TSBs. Improved content_html extraction (JSON body.html fallback).
- [x] **function.js** – Article content cache checks both normalized tables AND articles table. Articles cache applies normalizeMotorResponse for consistent filterTabs. articles/v2 normalizeMotorResponse always applied (not only for large catalogs).
- [x] **vehicle-data.service.ts** – Section strategies: comprehensive bucket names matching normalizeCategoryParams output (DTCs, TSBs, procedures, diagrams, component-locations). Article filter checks both bucket AND parent_bucket. loadSectionData always uses articles table for list view (simplified flow).
- [x] **data-sync.service.ts** – Eager: catalog metadata, `specifications` rows from catalog articles (non-fluid), parts if empty, mileage intervals + maintenance F/N/R frequency. Fluids API sync commented/disabled. `cacheVehicleMetadata` for home wizard. `syncSingleArticle` still lazy.
- [x] **home.component.ts** – Writes `vehicle_metadata` for `/years`, `/year/:y/makes`, `/year/:y/make/:make/models` (models payload includes engines).
- [x] **supabase.js** – `normalizeVehicleMetadataPath` so proxy + app use `/years` keys consistently with `metadataCacheMiddleware`.
- [x] **vehicle-dashboard.component.ts** – After `ensureVehicleRecord`, fires `eagerSyncVehicleReferenceData` (non-blocking) so Supabase fills without opening each section.
- [x] **Lazy normalization** – Common issues still on-demand; maintenance intervals also prefetched by eager sync (section path remains idempotent). Per-article HTML only via `syncSingleArticle` / article viewer.
- [x] **background_worker.js** – `extractContentSource(urlPath)` for `ensureVehicleExists` + article rows (not hard-coded `MOTOR`).
- [x] **ai_parser.js** – SCHEMAS for dtcs, tsbs, procedures, specifications unchanged (already aligned).
- [x] **Phase 1 (2026-03-19)** — SQL: `documentation/migrations/20260319_phase1_normalization.sql` + `supabase_schema.sql` extended. Worker: `insertEvidenceIngest` on articles/v2 catalog; `content_item` upsert via `content_item_mapper.js`. Native PDF text: `pdf_native_text.js` in procedure path when `body.html` missing. Scripts: `npm run migrate:phase1`. Types: `ContentItem` in `normalized_schema.ts`.
- [x] **Phase 1 verification (2026-03-20)** — added `vehapiproxi/scripts/verify-evidence-links-one-article.js` (`npm run verify:evidence-links`); supports `--vehicle`, `--source`, `--proxy`, `--token`; now suggests valid `--source` when catalog returns 500 on Vercel.
- [x] **Phase 1 worker traceability & PDF (code)** — `insertEvidenceLinks` after successful parse when `evidence_ingest` returns id; `content_item` enrichment from parsed body text; PDF pipeline native extract then optional Nemotron page vision (see `background_worker.js`, `nemotron_multimodal.js`).
- [x] **L1 spec_fact (2026-03-20)** — SQL: `documentation/migrations/20260320_l1_spec_fact.sql`; `npm run migrate:l1-spec-fact`; `supabase.js` `UPSERT_CONFLICT_COLUMNS.spec_fact`, `insertParsedData(..., { returnRepresentation })`; worker maps parsed specs → `spec_fact` + `evidence_link` (`l1-v1`); `NormalizedSpecFact` in `normalized_schema.ts`.
- [x] **L1 maintenance_task (2026-03-21)** — SQL: `documentation/migrations/20260321_l1_maintenance_task.sql`; `npm run migrate:l1-maintenance-task`; `supabase.js` `UPSERT_CONFLICT_COLUMNS.maintenance_task`; `data-sync.service.ts` `dualWriteMaintenanceTaskL1` after schedule upserts; `NormalizedMaintenanceTask` in `normalized_schema.ts`.
- [x] **L1 procedure_step (2026-03-22)** — SQL: `documentation/migrations/20260322_l1_procedure_step.sql`; `npm run migrate:l1-procedure-step`; `deleteProcedureStepsForArticle` + worker `buildProcedureStepRows`; `evidence_link` (`procedure_step`, `l1-v1`); `NormalizedProcedureStep` in `normalized_schema.ts`.
- [x] **L1 procedure_tool + procedure_part (2026-03-23)** — SQL: `documentation/migrations/20260323_l1_procedure_tool_and_part.sql`; `npm run migrate:l1-procedure-tool-part`; deletes + `buildProcedureToolRows` / `buildProcedurePartRows`; `evidence_link`; `NormalizedProcedureTool` / `NormalizedProcedurePart` in `normalized_schema.ts`.

### Data flow (eager reference + lazy article body)

```
Dashboard load → ensureVehicleRecord (0 Motor calls)
                → eagerSyncVehicleReferenceData (background): articles/v2 catalog metadata,
                  specifications (from articles), parts if empty, mileage + F/N/R maintenance
                → Home wizard → vehicle_metadata (years / makes / models+engines)
                → searchArticles still runs for UI; proxy may also enqueue background_worker catalog

Section opened → Supabase articles / specs / parts / maintenance when present
               OR → Motor API fallback → display + lazy* sync

Article opened → proxy article content (cached or Motor API)
               → syncSingleArticle with pre-fetched HTML (no double-fetch for list HTML)
               → background_worker AI parse into procedures/dtcs/tsbs tables

Specs / parts / maintenance sections → mostly cached after eager sync; lazy paths remain for gaps
```

### What remains (optional)

- **Fluids** – Re-enable `getFluids` → `specifications` when ready (`lazySyncFluids` / `syncFluids`).
- **Diagrams/component-locations** – No normalized table; section lists use articles only.
- **Future API fields** – Parts: quantity, fitment_notes. Maintenance: is_severe_service, labor_time_hours.
- **vehicle_metadata** – Existing rows keyed as `/api/years` may need one-time SQL path fix to `/years` for cache hits.

## Deploy verification baseline (production readiness)

**Recorded:** 2026-03-21 — **`main`** @ **`81f68a5`**. Items below were listed under **Bugs & Known Issues** as **Fixed (pending deploy)** or **Hardened (pending deploy)**.

| Issue | Fix (first commit on `main`) | Fix on `main` (git) | First prod deploy contains fix |
|-------|------------------------------|---------------------|--------------------------------|
| Motor.com session breaks after unlock — Supabase `Authorization` must not reach upstream | `c57339c` — strip `authorization` in `onProxyReq` (`vehapiproxi/src/function.js`) | Yes (`git merge-base --is-ancestor c57339c main`) | Fill **deployment id / time** from [Vercel](https://vercel.com) dashboard (not in repo) |
| Hardened: no Motor auth artifacts leak to browser | `2d91e05` — strip upstream auth headers on `onProxyRes` (`function.js`) | Yes | Same — confirm post-`2d91e05` production deploy |
| Backend deploy when only `vehapiproxi/**` changes | `03d400c` — `deploy-backend.yml` independent workflow; follow-ups `d69a524`, `5f63d04`, `6d4d6db` | Yes | Same — confirm backend project deploy after those commits |

**Prod deploy column:** Git cannot list Vercel deployment IDs. After each production deploy, note the dashboard deployment id or timestamp next to the row above.

**Local smoke (2026-03-21, this run):** `npm run build` at repo root — **OK**; `node --check vehapiproxi/src/index.js` — **OK**. (`/health` exists on local proxy when `node vehapiproxi/src/index.js` runs; not exercised here to avoid Motor auth startup.)
**Rate limit test:** run proxy on a free `PROXY_PORT`, set `ARTICLE_RATE_LIMIT_MAX=5` then `npm run test:article-rate-limit` in `vehapiproxi/` — expect **429** after the limit (requests may be **401** before that without auth).
