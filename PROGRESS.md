# PROGRESS

**Last updated**: 2026-03-25 — **Architecture contract (authoritative):** `documentation/DATA_SOURCE_AND_NORMALIZATION.md` — **Supabase = runtime source of truth**; Motor (via `vehapiproxi` only) = **index + ingest** when Supabase is missing data; **first vehicle access** → normalize catalog (buckets/silos/list) into Supabase **once**, then **Supabase-only** reads for that scope; **per-article bodies** → **lazy** normalize on first open, then permanent Supabase reads (phases Motor out of the hot path as the app is used). **Highest priority:** **phase out motor.com** — align code with that document; Motor remains **ingest-only** for user-visible parity until each surface is Supabase-backed. **Open bug:** common-issues suggested actions sometimes default to “consult the service manual” — should use **Supabase**-backed vehicle data (same Motor-off direction). **Ops:** `GET /health` on production returns `llmKeyConfigured` + `llmKeyEnv` (variable name only) so you can confirm which Vercel project’s serverless runtime sees `NVIDIA_API_KEY` / `LLM_API_KEY` — same-origin `/api` uses the **main** deploy project (`VERCEL_PROJECT_ID`), not necessarily the separate backend project. **Normalization release gate closed:** local production-readiness verification passes (`npm run verify:prod-readiness`), production `environment.features.l2Search` is enabled, and prior target DB migration/RPC/RLS checks remain validated via Supabase REST evidence. Golden verification remains green: `documentation/release-artifacts/golden-vehicle-verification-20260323-051007.md`. **Follow-up:** `vehicle_metadata` legacy `/api/...` keys handled in `getMetadata` + optional SQL cleanup; article lock overlay adds **full vehicle** unlock; `documentation/RELEASE_CHECKLIST.md` includes a short **Production smoke** section. **Post-normalization:** Motor `/fluids` → `specifications` (`Fluids` category) sync is active (eager + specs section). **2026-03-26 QA fixes:** Supabase `articles.code` / `articles.description` migration applied to project `vehapidb` (jzwhcoivwzumqrfscnlw); Motor parts/maintenance/catalog calls now pass resolved `motorVehicleId` (MOTOR + composite id) from `eagerSyncVehicleReferenceData` / lazy sync; article viewer `isLocked` re-subscribes to `creditsService.unlocks()` and unlock handlers `queueMicrotask(loadData)`; proxy `onError` returns JSON with `correlationId` + path.

## Summary

| Area | Status |
|------|--------|
| **Phase out motor.com** | **Highest priority** — end state: no runtime dependency on live Motor for normal flows; data served from Supabase (ingest continues until parity). Contract: **`documentation/DATA_SOURCE_AND_NORMALIZATION.md`**. See **What's Left to Do**. |
| Stripe Integration (Checkout, Portal, Webhooks) | Complete |
| Credits Service (Balance, Unlocks, Transactions) | Complete |
| Section-Level Content Locking | Complete |
| Article-Level Content Locking | Complete |
| UI/UX Copy Cleanup | Complete |
| Lock Overlay UX | Complete |
| Repo Structure Cleanup (`randdev/` + `oldfiles/`) | Complete |
| Data Normalization Pipeline | **Phase complete / release-ready** — catalog/content items, specs, maintenance, procedures, diagrams, component locations, labor, PDF/graphic media traceability, and L2 text retrieval are implemented and verified (including `verify:prod-readiness` + golden-vehicle pass); production `l2Search` flag is enabled |

### Active worker direction (normalization)

- **Shipped:** Phase 1 — `evidence_ingest`, `content_item` upsert + post-parse enrichment (`updateContentItemEnrichment`), catalog path in `vehapiproxi/src/background_worker.js` + `content_item_mapper.js`; `evidence_link` after parse for **`content_item`**, **procedures** (parent row), **dtcs**, **tsbs**, and L1 **`procedure_step`** / **`procedure_tool`** / **`procedure_part`** + **`spec_fact`** when schema present (legacy **`specifications`** → `spec_fact` only); native PDF text (`pdf_native_text.js`) and optional sparse-PDF Nemotron vision (`nemotron_multimodal.js`, `ENABLE_NEMOTRON_PDF_VISION_FALLBACK=true`); `npm run verify:evidence-links`; optional Cursor worker-loop (`hooks.json` → `auto-continue.mjs`, default ON — see `.cursor/WORKER_LOOP.md`).
- **Workspace (git):** `.cursor/WORKER_LOOP.md`, `.cursor/hooks.json`, `.cursor/hooks/*.mjs`, and `.cursor/agents/` may be **untracked** until committed — hooks only run in clones that have them. Loop toggle files (`.cursor/worker-loop.enabled` / `.disabled` / `.after-response`) are **gitignored** when present; default auto-continue is ON once hooks are registered (see `WORKER_LOOP.md`). **Desktop continue (Windows):** root **`npm run cursor:auto-once`** invokes **`scripts/continue-once.ps1`** (paste + Enter); see `scripts/automation/README.md`.
- **Next (phase):** **Top priority — phase out motor.com:** shrink and eliminate live Motor calls in the proxy and app; prefer Supabase-backed reads everywhere parity exists. Normalization release gate is already complete; remaining work is **Motor-off** completion (catalog, article bodies, YMME, parts, etc.) before optional polish.
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

- **Fixed 2026-03-25**: **`is_normalized` drift** — catalog upserts could fail while **`syncArticleCatalogMetadataOnly`** still set `is_normalized: true` when the Motor search returned rows (no per-chunk success check). **`eagerSyncVehicleReferenceData`** now sets **`is_normalized` only after** a post-pipeline **`articles` count** for that `vehicle_id` (true if count > 0; clears flag only when it was true and count is still 0). Re-runs catalog when the flag is true but **`articles` is empty**. **No Motor.com fallback** for normalized vehicles in **`VehicleDataService`** — Supabase is the runtime source; ingest fixes empty data.
- **Open (High)** — **Common issues — suggested action:** Generated items sometimes recommend a generic action such as “please consult the service manual,” which defeats the purpose of Torque. **Expected direction:** suggested actions should be derived from **data already in Supabase** for the vehicle (normalized procedures, DTCs, TSBs, specs, maintenance, evidence / L2 text, etc.), not from live Motor API calls — supports the **highest-priority** goal of **phasing out motor.com** (Motor ingest-only). Touchpoints: `/api/common-issues/generate`, `ai_parser` common-issues prompts, `common-issues-section` UI; may require passing structured Supabase context into generation or post-processing to forbid generic manual-only cop-outs when DB evidence exists.
- **Fixed 2026-03-25**: Production `POST /api/rewrite` returned `AI_MODULE_LOAD_FAILED` while `GET /health` showed `llmKeyConfigured: true` — `cheerio` / `turndown` were only in `vehapiproxi/package.json`; Vercel installs root dependencies for `api/index.js`. Added **`cheerio`** and **`turndown`** to root `package.json`.
- **Fixed 2026-03-18**: Motor/Article API 401 Unauthorized while logged in — interceptor previously forwarded Supabase `Authorization: Bearer ...` to Motor-proxy endpoints (years/catalog/parts/name), causing Motor to reject requests; now only attaches Bearer for `/api/credits/*` and `/api/source/*/vehicle/*/article/*` paths.
- **Fixed 2026-03-19**: Stripe redirect credit authorization sometimes failed due to Supabase session hydration race; `AuthService.getIdToken()` now always hydrates `_session/_user` signals, and `CreditsService.verifySession()` waits for `authService.user()` before calling `/api/credits/verify-session`.
- **Fixed 2026-03-19**: Motor.com session/auth breaks after buying/unlocking a single article — proxy forwarded Supabase `Authorization` header to Motor.com for article requests; backend strips `Authorization` in `vehapiproxi/src/function.js` `onProxyReq` before forwarding upstream (`c57339c` on `main`). **Production:** record deployment id in **Deploy verification baseline** below when confirmed in Vercel.
- **Fixed 2026-03-19**: Unauthenticated requests (cookies cleared) could still retrieve cached article content — `articleAccessMiddleware` was matching the wrong path shape because it expected `/api/source/...` even though it runs under `app.use('/api', ...)` (now correctly enforces `/source/...`).
- **Fixed 2026-03-19**: Hardened `articleContentCacheMiddleware` to only cache/serve the exact article-content route (not `/article/:id/title` or other sub-routes), preventing cached HTML leakage on unauthenticated calls.
- **Fixed 2026-03-19**: Reordered backend unlock checks so individually purchased articles (`article:${articleId}`) and `full` unlocks are honored even if article bucket metadata is missing/unmappable.
- **Hardened 2026-03-19**: Ensure no Motor.com auth artifacts leak past the proxy — `onProxyRes` strips `Authorization`/`WWW-Authenticate` and related upstream headers (`2d91e05` on `main`). **Production:** record deployment id in **Deploy verification baseline** below when confirmed in Vercel.
- **Fixed 2026-03-21**: Backend `vehapiproxi` was not deploying independently after Mar 13; `.github/workflows/deploy-backend.yml` deploys the backend project when `vehapiproxi/**`, `api/**`, or `vercel.json` change (`03d400c` + follow-ups on `main`). **Production:** record backend-project deployment id in **Deploy verification baseline** below when confirmed in Vercel.
- **Fixed 2026-03-19**: Vercel serverless cold-start crash from duplicated route module bodies (`vehapiproxi/src/routes/ai-endpoints.js`, `auth.js`, `credits-endpoints.js`) causing duplicate declaration parse errors; deduped modules and moved common-issues generation to lazy `getAiFunctions()` loading.
- **Fixed 2026-03-21**: Browser CORS failures on Vercel preview hostnames (and `127.0.0.1:3000`) — `function.js` now merges `CORS_ALLOWED_ORIGINS`, allows `https://$VERCEL_URL`, and shares origin checks with proxy response interceptor; **`inject-eruda.cjs`** pointed at repo-root `dist/` (was `randdev/dist`).
- **Fixed 2026-03-20**: GitHub Actions/Vercel deploys failing at build (`Cannot find module scripts/inject-eruda.cjs`) after repo cleanup moved scripts; root `package.json` build now calls `randdev/scripts/inject-eruda.cjs`.
- **Hardened 2026-03-20**: GitHub Actions workflows (`deploy.yml`, `deploy-backend.yml`) now set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to preempt Node 20 action-runtime deprecation rollout.
- **Fixed 2026-03-22**: Vercel prod — browser CORS errors (`/api/years`, `/auth/status`) because SPA origin (`vehapi-*.vercel.app`) differed from hardcoded proxy host `vehapiproxi.vercel.app`; credentialed fetch + `Access-Control-Allow-Origin: *` on auth. **Fix:** same-origin relative API + `vercel.json` routes for non-`/api` Express paths.
- **Fixed 2026-03-22**: **`FUNCTION_INVOCATION_FAILED` / 500** on `vehapiproxi.vercel.app` — Vercel installs **root** `package.json` only; `express-rate-limit` lived under `vehapiproxi/node_modules`, so serverless import of `rate_limit.js` crashed. **Fix:** add `express-rate-limit` to root `package.json` (CORS “missing header” was a side effect of 500 responses).
- **Fixed 2026-03-21**: Home page could get stuck with empty year data after initial load if `/api/years` landed during proxy re-authentication; `home.component.ts` now polls `/auth/status` and retries the initial years request automatically instead of requiring a manual page refresh.
- **Improved 2026-03-21**: Browser console auth polling noise is reduced; aborted/non-fatal `/auth/status` probe failures are no longer logged as hard errors in normal dev startup.
- **Fixed 2026-03-23 / 2026-03-24**: Local WSL/Windows `canvas` native-module mismatch could break `background_worker` load: static `import { parseWithAI } from './ai_parser.js'` evaluated `ai_parser.js`, and a **re-export** of `nemotron_multimodal.js` forced eager `canvas` before vision fallback could be skipped. **Fix:** removed re-exports from `ai_parser.js`; `background_worker.js` continues to dynamic-`import()` `nemotron_multimodal.js` only for PDF vision fallback.
- **Fixed 2026-03-21**: `home.component.ts` `loadYears` could recurse without bound after auth recovery if `/api/years` kept returning 401/403. **Fix:** cap attempts (`MAX_LOAD_YEARS_AUTH_RETRIES`) then set `years` to `null`.
- **Fixed 2026-03-21**: Article viewer `unlockFullVehicle` passed article title as `vehicleName` to `unlockModule`; now passes `vid` like `unlockSection` / `unlockThisArticle` for consistent server-side transaction records.
- **Fixed 2026-03-21**: Removed accidentally tracked `backups/` and `test-results/` (bundles/archives); added both to root `.gitignore`.
- **Fixed 2026-03-24**: Removed intermediate FAIL golden-vehicle reports under `documentation/release-artifacts/`; retained the passing artifact `golden-vehicle-verification-20260323-051007.md` referenced here.
- **Shipped 2026-03-24**: Motor `/fluids` → Supabase `specifications` (`category: 'Fluids'`) — `data-sync.service.ts` `syncFluids` / `syncFluidsIfMissing`, called from `eagerSyncVehicleReferenceData` and `lazySyncFluids` before `SpecsFluidsSectionComponent` loads (normalized vehicles).
- **Shipped 2026-03-24**: **Motor Information API** (`api.motor.com`) — separate DaaS keys (`MOTOR_INFORMATION_PUBLIC_KEY` / `MOTOR_INFORMATION_PRIVATE_KEY`); `GET /api/source/.../fluids` uses RecommendedFluids when query params `baseVehicleId` + `engineId` are present; `GET /api/motor-information/ymme/base-vehicle` and `/ymme/engines` (Bearer JWT) for YMME resolution. Docs: `vehapiproxi/MOTOR_INFORMATION_API.md`; path templates: `vehapiproxi/fluidscfg.example.json`. **Removed** committed `vehapiproxi/fluidscfg.json` (contained keys — rotate in Motor portal if exposed).
- **Shipped 2026-03-24**: **App wiring** — `PersistedVehicle` stores YMME + `motorEngineId`; `home.component` saves on navigate; `vehicle-dashboard` merges persistence and resolves `motorBaseVehicleId` when user is signed in; auth interceptor attaches Bearer to `/api/motor-information/*`; fluids load/sync pass Motor Information query params when `motorBaseVehicleId` + `motorEngineId` are present.
- **Docs 2026-03-24**: `documentation/DEPLOYMENT.md` — **GitHub Actions and Vercel deploy verification** (two workflows, secrets, post-push checklist); **Deploy verification baseline** below links to it.
- **Fixed 2026-03-26**: `sync-progress-overlay` used `i-lucide` with string names (`database` / `shield-check`) without Lucide icon providers — replaced with `lucide-icon` + `[img]` (`Database`, `ShieldCheck`) to match the rest of the app.
- **Fixed 2026-03-26**: Production `articles` REST **400** (`code` / `description`) — migration `documentation/migrations/20260326_articles_code_description.sql` applied to Supabase project **vehapidb** (columns verified via SQL). Other environments: run the same DDL if PostgREST still reports missing columns.
- **Improved 2026-03-26**: **AI 503 UX** — `AiRewriteService` returns structured results for rewrite + common issues; article viewer shows dismissible banner when rewrite returns 503; common-issues section shows `app-empty-state` when AI is unavailable. **Common issues unlock** — removed `alert`/`confirm`; matches DTC-style one-tap unlock. **Docs:** `documentation/RELEASE_CHECKLIST.md` **Manual full pass (browser)** when Cursor Browser is unavailable. **Ops:** `/api/rewrite` and `/api/common-issues/generate` still return **503** if `NVIDIA_API_KEY` / `LLM_API_KEY` is unset on the server — configure in Vercel (no keys in repo).
- **Fixed 2026-03-26**: Article viewer “Content Locked” after successful `/api/credits/unlock` when `moduleType` is unresolved — `isLocked` already used `hasAccess(vid, '', articleId)`; hardened with explicit `creditsService.unlocks()` in the computed (signal invalidation) and `queueMicrotask(() => loadData())` after unlock / refresh so content fetch runs after unlock state updates (`src/pages/article-viewer/article-viewer.component.ts`).
- **Fixed 2026-03-26**: Parts / maintenance schedule Motor calls could 500 when OEM `vehicleId` was used without the composite Motor id — `MotorApiService.motorVehicleRoute` + optional `motorVehicleId` on `searchArticles`, `getParts*`, maintenance schedule getters; `DataSyncService` + `VehicleDataService` thread `motorVehicleId` from the dashboard (`vehicle-dashboard.component.ts` → `eagerSyncVehicleReferenceData`).
- **Improved 2026-03-26**: Proxy `onError` returns JSON `{ error, message, correlationId, path }` instead of plain “Proxy Error” (`vehapiproxi/src/function.js`).
- **Docs/ops 2026-03-25**: `documentation/DEPLOYMENT.md` — Vercel **does not** apply a committed/uploaded `.env` to serverless; set `NVIDIA_API_KEY` or `LLM_API_KEY` under Project → Environment Variables for **Production**, then **Redeploy**. `vehapiproxi/src/routes/ai-endpoints.js` returns distinct `code` values: `MISSING_LLM_KEY` (key absent at runtime) vs `AI_MODULE_LOAD_FAILED` (dynamic import of `ai_parser` failed — check function logs). Root `package.json` adds explicit **`zod`** dependency so `ai_parser` can load on clean installs.

## What's Left to Do

| Priority | Task |
|----------|------|
| **Highest** | **Phase out motor.com:** drive the app and proxy toward **Supabase-only reads** for user-visible data; keep Motor **only** for ingestion/sync until each surface has parity, then remove upstream calls. **Contract:** `documentation/DATA_SOURCE_AND_NORMALIZATION.md` (eager catalog once per vehicle, lazy per-article bodies, no Motor fallback display when data should be normalized). (Strategic north star — supersedes feature-level priorities.) |
| **High** | **Common issues:** Stop generic “consult the service manual” (or equivalent) as the primary suggested action when Supabase holds vehicle-specific data — ground actions in normalized Supabase rows + evidence (supports Motor-off). See **Bugs & Known Issues** (open bullet). |
| **High** | (Completed 2026-03-23) DB migration/RPC/RLS release target checks were validated via Supabase REST; local `npm run verify:prod-readiness` is now PASS; production `environment.features.l2Search` is now enabled. |
| Medium | Phase-1 worker regression completed locally: `cd vehapiproxi && npm run verify:evidence-links -- --local --vehicle=2854 --source=GeneralMotors --article=7042430` (PASS). |
| Medium | `cd vehapiproxi && npm run verify:release-target` (pg-based) is failing on this machine with `ECONNRESET`, but the same “release target” requirements were validated via Supabase REST checks (tables + RPC + RLS sanity) as described above. |
| Medium | Golden-vehicle normalization verification (local Node 22) green: `documentation/release-artifacts/golden-vehicle-verification-20260323-051007.md`. |
| Medium | (Done 2026-03-24) Home wizard persists YMME + `motorEngineId`; dashboard caches `motorBaseVehicleId` via `/api/motor-information/ymme/base-vehicle` when signed in; `VehicleDataService` + `DataSyncService` pass Motor Information params on `/fluids`. |
| Low | Commit `.cursor/hooks.json`, `.cursor/hooks/*.mjs`, `.cursor/WORKER_LOOP.md` (and `.cursor/agents/*`) when the team should share Cursor auto-continue / orchestrator docs |
| Low | (cleared 2026-03-24) AGENTS.md ↔ WORKER_LOOP: hook toggles + `npm run cursor:auto-once` / `continue-once.ps1` documented |
| Low | (Done 2026-03-23) Full-vehicle unlock on article lock overlay (`unlockModule` → `full`, `COSTS.FULL_ACCESS`) |

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
- [x] **Diagram/component-location/labor documents (2026-03-22)** — SQL: `documentation/migrations/20260322_normalized_diagrams_component_locations_labor.sql`; `npm run migrate:normalized-diagrams-labor`; new tables **`diagram_document`**, **`component_location_document`**, **`labor_operation`** in `supabase_schema.sql`; worker routes article HTML / labor detail payloads into normalized document rows; article cache reads those rows; article viewer loads `L:` ids via labor API.
- [x] **Graphic `media_asset` capture (2026-03-22)** — `function.js` persists `/api/source/:contentSource/graphic/:id` binary responses into `media_asset` via `upsertMediaAssetGraphicBinary`, complementing the existing PDF article-body path.
- [x] **Traceability closure for arbitrary article verification (2026-03-22)** — article parse paths in `background_worker.js` now create `evidence_link` rows for the matching `content_item`, so release verification no longer depends on landing on a procedure/DTC/TSB-specific normalized row.
- [x] **Golden-vehicle verification pass (2026-03-23)** — local Node 22 run passes with report at `documentation/release-artifacts/golden-vehicle-verification-20260323-051007.md`. Follow-up fixes included verify-mode forced reparse, early `content_item` evidence linking, case-insensitive `content_item` reuse, and verifier selection of the best enriched row when historical duplicate source-casing rows exist.

### Data flow (contract: Supabase first; Motor for ingest gaps only)

```
Dashboard load → ensureVehicleRecord (no upstream Motor from browser)
                → eagerSyncVehicleReferenceData (background): if catalog empty in Supabase,
                  Motor index → normalize → articles/catalog rows; then specs, fluids, parts,
                  maintenance as implemented
                → vehicle_metadata cache (years / makes / models+engines) via home wizard

After catalog exists in Supabase → section lists / menus read Supabase (no Motor “display fallback”
  for normalized scope — fix ingest if empty)

Section opened → read Supabase when rows exist; ingest from Motor only to fill missing normalized data

Article opened (lazy body) → if HTML not in Supabase: proxy may fetch upstream once → syncSingleArticle /
  cache → persist; thereafter Supabase-served. Worker may parse into procedures/dtcs/tsbs tables.

Ongoing work → align every read path with documentation/DATA_SOURCE_AND_NORMALIZATION.md

**2026-03-25 (code):** `VehicleDataService` — normalized vehicles no longer use Motor API for **section article lists**, **maintenance**, or **parts** when Supabase is empty; shows empty state + background lazy ingest (`lazySyncMaintenanceInterval`, `lazySyncParts`). See doc **Implementation status**.

**2026-03-25 (code):** `articles/v2` proxy cache — **was** serving any Supabase `articles` count > 0 (e.g. 8 rows), so UI + `DataSyncService` never saw the full Motor catalog (4169). **Now:** serve from Supabase only when `vehicles.is_normalized` **and** `count >= ARTICLE_CATALOG_MIN_ROWS` (default **10**); `?torqueCatalogSync=1` bypasses cache for **`syncArticleCatalogMetadataOnly`**; `getVehicleArticles` paginates (1000/page) so large catalogs return fully from DB.
```

### What remains (optional)

- **Fluids** – **Done in app (2026-03-24):** `lazySyncFluids` + `syncFluids` populate `specifications` from Motor `/fluids` (eager + specs section); verify against live Motor responses if field names differ by content source.
- **Future API fields** – Parts: quantity, fitment_notes. Maintenance: is_severe_service, labor_time_hours.
- **vehicle_metadata** – Legacy rows keyed as `/api/years` are served via `getMetadata` fallback + optional SQL `documentation/migrations/20260323_vehicle_metadata_legacy_path_cleanup.sql`.

## Deploy verification baseline (production readiness)

**Recorded:** 2026-03-22 — **`main`** @ **`870002b`**. Tracks the three items above that previously said “pending deploy”; fixes are **verified on `main`** (git); **Vercel deployment id/time** is still filled manually after each prod release.

| Issue | Fix (first commit on `main`) | Fix on `main` (git) | First prod deploy contains fix |
|-------|------------------------------|---------------------|--------------------------------|
| Motor.com session breaks after unlock — Supabase `Authorization` must not reach upstream | `c57339c` — strip `authorization` in `onProxyReq` (`vehapiproxi/src/function.js`) | Yes (`git merge-base --is-ancestor c57339c main`) | Fill **deployment id / time** from [Vercel](https://vercel.com) dashboard (not in repo) |
| Hardened: no Motor auth artifacts leak to browser | `2d91e05` — strip upstream auth headers on `onProxyRes` (`function.js`) | Yes | Same — confirm post-`2d91e05` production deploy |
| Backend deploy when only `vehapiproxi/**` changes | `03d400c` — `deploy-backend.yml` independent workflow; follow-ups `d69a524`, `5f63d04`, `6d4d6db` | Yes | Same — confirm backend project deploy after those commits |

**Prod deploy column:** Git cannot list Vercel deployment IDs. After each production deploy, note the dashboard deployment id or timestamp next to the row above.

**CI / Vercel:** After pushing to `main`, verify GitHub Actions workflows (especially **Deploy Backend (vehapiproxi)** when `vehapiproxi/**` changes) and Vercel env on the API project — see **`documentation/DEPLOYMENT.md`** section **GitHub Actions and Vercel deploy verification**.

**Local smoke (2026-03-21, this run):** `npm run build` at repo root — **OK**; `node --check vehapiproxi/src/index.js` — **OK**. (`/health` exists on local proxy when `node vehapiproxi/src/index.js` runs; not exercised here to avoid Motor auth startup.)
**Rate limit test:** run proxy on a free `PROXY_PORT`, set `ARTICLE_RATE_LIMIT_MAX=5` then `npm run test:article-rate-limit` in `vehapiproxi/` — expect **429** after the limit (with `SKIP_ARTICLE_ACCESS_AUTH` + dev, responses may be **404** upstream until limit; without skip, **401** before auth). With a valid Bearer token, the bucket is per user (`sub`), not shared IP.
