# PROGRESS

**Last updated**: 2026-03-20 — **L1 `spec_fact`:** migration `documentation/migrations/20260320_l1_spec_fact.sql`, `npm run migrate:l1-spec-fact`, `supabase_schema.sql` + worker dual-write from AI specs (`insertParsedData` + `evidence_link` as `spec_fact`). Specifications path: no `content_html`/`external_id` sent to legacy table. Prior: external automation scripts; Phase 1 shipped. **Next L1 slice:** `maintenance_task` table + worker.

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

- **Shipped:** Phase 1 — `evidence_ingest`, `content_item` upsert + post-parse enrichment (`updateContentItemEnrichment`), catalog path in `vehapiproxi/src/background_worker.js` + `content_item_mapper.js`; `evidence_link` after parse for **procedures / dtcs / tsbs** + for **`spec_fact`** rows when schema present (legacy **`specifications`** has no `external_id` — links target L1 facts); native PDF text (`pdf_native_text.js`) and optional sparse-PDF Nemotron vision (`nemotron_multimodal.js`, `ENABLE_NEMOTRON_PDF_VISION_FALLBACK=true`); `npm run verify:evidence-links`; optional Cursor worker-loop (`hooks.json` → `auto-continue.mjs`, default ON — see `.cursor/WORKER_LOOP.md`).
- **Workspace (git):** As of this pass, `.cursor/WORKER_LOOP.md`, `.cursor/hooks.json`, `.cursor/hooks/*.mjs`, and `.cursor/agents/` are **untracked** (`git status`) — hooks only run in clones that have them. Loop toggle files (`.cursor/worker-loop.enabled` / `.disabled` / `.after-response`) are **gitignored** when present; default auto-continue is ON once hooks are registered (see `WORKER_LOOP.md`).
- **Next (code):** L1 **`maintenance_task`** migration + worker wiring, then richer **`procedure`** L1 / plan §3.5; parallel domains per plan (wiring diagrams, labor, TSB+DTC depth, etc.). **`spec_fact`** migration + worker path shipped in repo (`migrate:l1-spec-fact`).
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
| **High** | Greenfield plan: `docs/plans/2026-03-18-normalization-schema-design.md`; **L1 `spec_fact`** in repo (`20260320_l1_spec_fact.sql` + worker); **next:** `maintenance_task` migration + worker; then procedure/L2/RAG as scoped |
| Medium | Rate limiting on article content API |
| Medium | Phase-1 worker regression: after `vehapiproxi` or `background_worker.js` changes, `cd vehapiproxi && npm run verify:evidence-links -- --vehicle=<id> --source=<CONTENT_SOURCE>` (requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env`; optional `--proxy=http://localhost:3000` for dev; use catalog-valid `--source` if proxy returns 500) |
| Low | Commit `.cursor/hooks.json`, `.cursor/hooks/*.mjs`, `.cursor/WORKER_LOOP.md` (and `.cursor/agents/*`) when the team should share Cursor auto-continue / orchestrator docs |
| Low | **Doc drift:** `AGENTS.md` still says create `.cursor/worker-loop.enabled` to enable the loop; implementation is **default ON** when hooks load — optional `worker-loop.enabled` is back-compat only (`auto-continue.mjs`). Align that sentence with `.cursor/WORKER_LOOP.md` |
| Low | Full-vehicle unlock option from lock overlay |

## Vehicle data normalization / migration

### Completed

- [x] **normalized_schema.ts** – NormalizedArticle added (all Motor API catalog fields). NormalizedVehicle has is_normalized. Existing interfaces unchanged.
- [x] **supabase_schema.sql** – Articles table: added code, description, sort, bulletin_number, release_date columns + parent_bucket index. Migration SQL included.
- [x] **supabase.js** – ensureVehicleExists (FK safety), markVehicleNormalized, checkArticleContent (articles table cache). UPSERT_CONFLICT_COLUMNS unchanged.
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
