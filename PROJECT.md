# Torque — Project Source of Truth

> **Every agent, developer, and AI assistant working on this repo must read this file first and adhere to everything in it.**
> This is the single authoritative source for architecture, status, rules, bugs, and roadmap.
> `PROGRESS.md` is the detailed change log. This file is the compact, always-current decision record.

---

## 1. What Is This

**Torque** is a vehicle-service intelligence web app. It lets users select a vehicle (year/make/model/engine) and access repair procedures, DTCs, TSBs, specs, diagrams, maintenance schedules, parts, and labor data — sourced from the Motor API, stored in Cloud SQL, and served via an authenticated Express proxy.

Users pay for content access via Stripe credits. AI rewrites raw Motor HTML into readable prose. A streaming chatbot generates interactive step-by-step tutorials grounded in the vehicle's actual repair data.

---

## 2. Infrastructure (Current — GCP Only)

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend | Firebase Hosting | Angular 19 SPA |
| Backend proxy | Cloud Run (`motorapi-auth-proxy`) | `vehapiproxi/` |
| Database | Cloud SQL for PostgreSQL | `vehapi-torque:us-central1:vehapi` |
| AI (parsing/rewrite/chat) | OpenRouter → Gemini 2.5 Flash | `OPENROUTER_API_KEY` |
| Auth | Firebase Authentication | JWT validated by backend |
| Payments | Stripe | Checkout, portal, webhooks |
| Ingest proxy | localhost:3001 (dev) / Cloud Run (prod) | Motor EBSCO session |
| Local DB tunnel | Cloud SQL Auth Proxy → port 5433 | dev only |

**Supabase and Vercel are fully decommissioned. Do not reference them.**

---

## 3. Repository Layout

```
/                          Angular workspace root
├── src/                   Angular 19 frontend
│   ├── pages/             route-level components
│   ├── components/        shared UI components
│   ├── services/          injectable services
│   ├── models/            TypeScript interfaces
│   ├── utils/             pure helpers
│   └── environments/      environment.ts / environment.prod.ts
├── vehapiproxi/           Express backend
│   ├── src/               Express app source
│   ├── scripts/           ingest workers, dashboard, proxy aggregator, stack
│   ├── migrations/        Cloud SQL migration SQL files
│   └── .env               secrets (not committed)
├── documentation/         Architecture docs (keep current)
├── docs/plans/            Active implementation plans
├── tools/gcp/             Cloud Run env config
├── randdev/               Research / archived tooling (m1_crawler)
├── cloudsql_schema.sql    Full DB DDL
├── PROJECT.md             ← THIS FILE — source of truth
├── PROGRESS.md            Detailed change log (append new entries at top)
└── AGENTS.md              Agent coding guide (read after this file)
```

---

## 4. Architecture Rules (Non-Negotiable)

### 4.1 Data Source Contract

| Rule | Detail |
|------|--------|
| **Database is runtime truth** | All user-facing reads use Cloud SQL when rows exist. |
| **Motor is ingest-only** | Motor API is only accessed server-side via `vehapiproxi`. Never call Motor from `src/`. |
| **Catalog: one-time ingest** | First visit with no catalog rows → ingest Motor index → store normalized rows → future visits read DB only. |
| **Article bodies: lazy** | First open of an uncached article may fetch Motor, normalize, persist. Subsequent opens are DB-only. |
| **No Motor display fallback** | If DB is empty, show empty state + trigger background ingest. Never display live Motor data as the UI source. |

### 4.2 Frontend Rules

- **Standalone Angular components only** — never create `NgModule`
- Use `@if` / `@for` / `@switch` control flow — not `*ngIf` / `*ngFor`
- **Signals** for synchronous/local state; **RxJS** for async streams
- Never nest `.subscribe()` inside another `.subscribe()` — use `switchMap` / `mergeMap`
- `providedIn: 'root'` for all services
- Mobile-first: base styles for small screens, `md:` / `lg:` for larger
- Minimum **44px touch targets** on all interactive elements
- `OnPush` change detection on all components where possible

### 4.3 Backend Rules

- Express routes only via `vehapiproxi/src/routes/` — no logic in `function.js` directly
- All DB access via `db.js` / `db.service.js` — no raw `pg` clients elsewhere
- Winston logger (`logger.js`) for all server logs — no `console.log` in production paths
- Auth middleware validates Firebase JWT on all `/api/credits/*` and article-access routes
- Proxy pool (`proxy-pool.js`) handles all outbound Motor connections — never bypass it

### 4.4 Agent Behavior Rules

- **Read `PROJECT.md` before any code change**
- **Update `PROGRESS.md`** at the top with a new entry when completing any meaningful work
- **Never** reference Supabase, Vercel, Netlify, or Firestore in new code
- **Never** make Motor API calls from Angular `src/` — backend only
- **Never** create `NgModule` in Angular code
- **Commit and push** changes to GitHub after completing a task (`git add`, `git commit`, `git push`)
- **Test** TypeScript changes: `npx tsc --noEmit` before declaring done
- **Syntax check** backend JS: `node --check <file>` before declaring done

---

## 5. Current Status (as of 2026-05-26)

### Infrastructure
- ✅ GCP-only stack (Cloud Run + Firebase Hosting + Cloud SQL)
- ✅ Cloud SQL Auth Proxy for local dev
- ✅ Rotating outbound proxy pool (`proxy-pool.js`) for Motor requests
- ✅ Free proxy aggregator (`scripts/proxy-aggregator.mjs`) — 17 GitHub sources, 1,500 proxies

### Ingest Pipeline
- ✅ Worker (`worker-ingest-vehicles-full.js`) — catalog + reference data + optional corpus
- ✅ Multi-backend stack (`npm run stack`) — aggregator + N proxy backends + M workers (round-robin)
- ✅ Ingest dashboard (`npm run ingest:dashboard`) — `http://localhost:3847` (progress bar, ETA, backends panel)
- ✅ `--auto-reset-failed` — auto-resets failed→pending trackers each pass
- ✅ `--no-proxy` mode — bypasses free proxy pool; uses system default route (ProtonVPN)
- ✅ **Root cause fixed (2026-05-29)** — `?torqueCatalogSync=1` was subscription-blocked; dropped param, `/articles/v2` returns full data
- 🔄 **Catalog ingest running** — ~979 / 36,723 complete, ~400/hr, ETA ~3 days via ProtonVPN

### Normalization
- ✅ `content_item` upsert + enrichment pipeline
- ✅ `procedures`, `dtcs`, `tsbs`, `specifications`, `maintenance_task`, `diagram_document`, `labor_operation` tables populated by worker
- ✅ AI parsing via Gemini 2.5 Flash (native JSON schema, retry with Zod error feedback)
- ⚠️ Only ~2,175 vehicles fully normalized — blocked on catalog recovery above

### Frontend
- ✅ Article viewer — DB-first read, Motor fallback only for un-normalized vehicles
- ✅ DTC / TSB / procedures / specs / diagrams / maintenance / parts — all sections wired
- ✅ Stripe credits + unlock flow
- ✅ Streaming AI tutorial chatbot (SSE)
- ✅ Command palette (⌘K)
- ✅ Workshop shell (desktop) + floating dock (mobile)
- ✅ Minimalist terracotta design system

---

## 6. Active TODO

| Priority | Item | Owner |
|----------|------|-------|
| 🔴 ACTIVE | **Catalog ingest running** — ~979/36,723 complete (~400/hr, ETA ~3 days); monitor at http://localhost:3847 | Operator |
| 🟠 HIGH | After catalog completes: run normalization pass (`npm run stack:meta`) | Operator |
| 🟠 HIGH | SQL/API refactor Phase 2 — see `docs/plans/2026-05-23-sql-api-refactor.md` | Agent |
| 🟡 MEDIUM | `documentation/DATA_SOURCE_AND_NORMALIZATION.md` still references Supabase — update to Cloud SQL | Agent |
| 🟡 MEDIUM | `AGENTS.md` still references Supabase and Firestore in places — audit and update | Agent |
| 🟡 MEDIUM | Seed `vehicle_metadata` for years/makes after catalog recovery (`npm run seed:ymme`) | Operator |
| 🟢 LOW | L2 RAG corpus setup (Vertex AI) — `VERTEX_RAG_CORPUS` env var | Operator |
| 🟢 LOW | Document AI Layout Parser processor setup — `DOCUMENT_AI_PROCESSOR` env var | Operator |

---

## 7. Known Bugs

| Status | Bug | File / Location |
|--------|-----|----------------|
| 🟡 Monitor | Auth fails if all 8 proxy attempts exhausted on cold start (no live proxies yet) | `vehapiproxi/src/auth.js` |
| 🟡 Active | `articleCache` in `MotorApiService` TTL is 5 min — stale for very recently ingested vehicles | `src/services/motor-api.service.ts` |
| 🟡 Active | Probe mode (`--probe`) takes several minutes on first aggregator start — startup delay for `npm run stack` | `scripts/proxy-aggregator.mjs` |
| 🟡 Monitor | Rate calculation in dashboard `/api/catalog-stats` needs a few snapshot intervals before showing rate/hr | `scripts/ingest-progress-dashboard.mjs` |
| 🟢 Monitor | Free proxy quality is inconsistent — dead proxies rotate out but initial auth may still fail on cold start | `src/proxy-pool.js` |

---

## 8. Completed (Recent — last 30 days)

| Date | Work |
|------|------|
| 2026-05-29 | Root cause fix: `?torqueCatalogSync=1` was subscription-blocked on all vehicles; dropped param, plain `/articles/v2` works. Added `--no-proxy` flag for direct VPN routing. Worker sharding prevents vehicle collisions across workers. |
| 2026-05-28 | Multi-backend ingest stack: `--backends=N` spawns N independent proxy backends; `--auto-reset-failed` worker flag; dashboard rewritten with progress bar, ETA, backends panel, rate/hr; priority CSV; stealth pacing flags |
| 2026-05-26 | Project cleanup: removed ~50 deprecated files (Supabase migrations, Vercel CI, Cursor artifacts, Windows scripts, stale plans) |
| 2026-05-26 | Proxy session-IP pinning: `pinProxy()/unpinProxy()` added to ProxyPool; `auth.js` pins after successful auth so all Motor API requests use the same IP; `rejectUnauthorized: false` for socks5 TLS; pinned proxy preserved across refresh cycles |
| 2026-05-26 | Motor 403 root-caused: `articles/v2?torqueCatalogSync=1` blocked at subscription level for all vehicles; DB-cached reads (no torqueCatalogSync) and YMME endpoints work normally |
| 2026-05-26 | CI/CD: added `.github/workflows/deploy.yml` (Cloud Run + Firebase on every push to main); requires `GCP_SA_KEY` and `FIREBASE_SERVICE_ACCOUNT` secrets |
| 2026-05-26 | DTC error state: shows "Failed to Load DTCs" + Retry button instead of "No Fault Codes" when network/auth fails |
| 2026-05-26 | Auth sticky proxy fix: entire EBSCO→Motor chain now uses one proxy per attempt via `buildStickyAgent()`; stale "Firestore" logs removed |
| 2026-05-26 | Proxy pool wired into `auth.js` with `reportFailure` + `getCurrentAgentWithUrl`; auth retries 8 proxies before failing |
| 2026-05-26 | `run-stack.mjs` orchestrator: single command starts aggregator → proxy server → worker in sequence; kills stale :3001 process |
| 2026-05-26 | `proxy-aggregator.mjs`: 17 GitHub free proxy sources, TCP liveness probe, 1,500 proxies served |
| 2026-05-26 | Three worker fixes: write-chain serializer, `skipped_by_policy` retriable, independent reference scopes |
| 2026-05-26 | Three frontend fixes: double `loadData()` guard, DTC `switchMap` refactor, `articleCache` TTL |
| 2026-05-21 | GCP migration complete: Vercel + Supabase fully decommissioned |
| 2026-05-21 | Cloud SQL B-tree query optimization for `resolveAssociatedVehicleIds` |
| 2026-05-21 | Dynamic YMME name resolution endpoint (`/api/source/:cs/:vid/name`) |

---

## 9. Ideas / Roadmap

| Idea | Notes |
|------|-------|
| **Paid proxy tier** | Add Webshare/Bright Data/Oxylabs residential proxies to `OUTBOUND_PROXY_LIST` for higher reliability than free GitHub lists |
| **Ingest parallelism** | `run-stack.mjs` could spawn 4 worker shards via `--offset` + `--limit` for ~4x throughput on 34k backlog |
| **RAG chatbot grounding** | Wire `VERTEX_RAG_CORPUS` + `DOCUMENT_AI_PROCESSOR` for richer tutorial grounding |
| **Offline mode** | Service Worker caching for article bodies already in DB — works without network |
| **Push notifications** | Notify user when a vehicle's ingest completes / new content available |
| **Admin dashboard** | Web UI for ingest status, proxy pool health, DB stats — extend ingest dashboard |
| **VIN decode → auto-select** | VIN input on home screen → auto-fills year/make/model/engine |
| **Alldata / Mitchell parity** | Cross-reference Motor coverage gaps with Alldata/Mitchell for missing procedures |

---

## 10. Blueprint — Key Flows

### Vehicle Data Flow
```
User selects vehicle
  → HomeComponent: /api/years → /api/makes → /api/models (DB cache via vehicle_metadata)
  → Navigate to /vehicle/:source/:vehicleId
  → VehicleDashboardComponent: ensureVehicleRecord → eagerSyncVehicleReferenceData (background)
    → If catalog empty: worker ingests Motor → normalizes → writes articles/content_item rows
    → Sections read Cloud SQL (articles, procedures, dtcs, etc.)
  → User opens article
    → ArticleViewerComponent: DB-first (content_item → articles.enhanced_content → articles.original_content)
    → If missing: fetchSave via vehapiproxi → normalize → persist → return to client
    → Future opens: DB-only
```

### Ingest Stack Flow
```
npm run stack
  → proxy-aggregator.mjs (:3848) — fetches 13k proxies from GitHub, probes, serves 1.5k
  → src/index.js (:3001) — loads proxy pool from :3848, starts Motor EBSCO auth
  → worker-ingest-vehicles-full.js — reads motor-ymme-full.csv, processes each vehicle:
      catalog scope → /articles/v2?torqueCatalogSync=1 → articles table
      reference scopes → fluids, parts, maintenance intervals/frequencies
      (optional --with-articles) → per-article body → background_worker → AI parse → normalized tables
```

### Credit / Unlock Flow
```
User opens locked article
  → CreditsService.hasAccess(vehicleId, moduleType, articleId) → false
  → Lock overlay shown
  → User clicks "Unlock" → CreditsService.unlockArticle(articleId, 100 credits)
  → POST /api/credits/unlock → deduct credits → store unlock record
  → ArticleViewerComponent: loadData() after unlock
```

### Auth Flow (Motor EBSCO)
```
authManager.authenticate()
  → GET https://search.ebscohost.com/login.aspx?... (via rotating socks5/http proxy)
  → Follow redirects, collect cookies
  → GET https://sites.motor.com/m1 (via proxy)
  → Store session cookies in Cloud SQL (system_sessions)
  → All Motor proxy requests use stored cookies
  → On 401/403: rotate proxy → re-authenticate
```

---

## 11. Local Dev Quickstart

```bash
# Prerequisites
cloud-sql-proxy --port 5433 vehapi-torque:us-central1:vehapi &

# Full ingest stack (proxy aggregator + proxy server + worker)
cd vehapiproxi && npm run stack

# Or: just the proxy server (no ingest)
cd vehapiproxi && npm run dev

# Angular dev server (separate terminal)
npm start   # http://localhost:4200, proxies /api → :3001

# Ingest dashboard
cd vehapiproxi && npm run ingest:dashboard   # http://localhost:3847

# Normalization-only pass (no re-fetching Motor)
cd vehapiproxi && npm run stack:meta
```

### Key npm scripts (`vehapiproxi/`)

| Script | What it does |
|--------|-------------|
| `npm run stack` | Full stack: aggregator (probe) + proxy server + worker (`--resume --retry-failed --continuous`) |
| `npm run stack:meta` | Same but worker uses `--metadata-only` (normalization pass) |
| `npm run stack:no-probe` | Skip TCP probe — faster startup, more dead proxies |
| `npm run dev` | Proxy server only (hot reload) |
| `npm run ingest:dashboard` | Progress UI at :3847 |
| `npm run proxy:aggregator` | Proxy aggregator only |
| `npm run worker:ingest-full` | Worker (single pass, no continuous) |

---

## 12. File Ownership Map

| Area | Canonical Files |
|------|----------------|
| DB schema | `cloudsql_schema.sql`, `vehapiproxi/migrations/` |
| Motor auth | `vehapiproxi/src/auth.js` |
| Proxy routing | `vehapiproxi/src/function.js` |
| Proxy pool | `vehapiproxi/src/proxy-pool.js` |
| AI parsing | `vehapiproxi/src/ai_parser.js`, `ai_parser_schemas.js` |
| Normalization worker | `vehapiproxi/src/background_worker.js` |
| Bulk ingest worker | `vehapiproxi/scripts/worker-ingest-vehicles-full.js` |
| Proxy aggregator | `vehapiproxi/scripts/proxy-aggregator.mjs` |
| Stack launcher | `vehapiproxi/scripts/run-stack.mjs` |
| Ingest dashboard | `vehapiproxi/scripts/ingest-progress-dashboard.mjs` + `.html` |
| Angular entry | `index.tsx` (routes), `src/app.component.ts` |
| Article viewer | `src/pages/article-viewer/article-viewer.component.ts` |
| Vehicle dashboard | `src/pages/vehicle-dashboard/vehicle-dashboard.component.ts` |
| Data sync | `src/services/data-sync.service.ts` |
| Motor API calls | `src/services/motor-api.service.ts` |
| Vehicle data | `src/services/vehicle-data.service.ts` |
| Design tokens | `src/styles.css`, `tailwind.config.js` |
| Cloud Run config | `tools/gcp/motorApiAuthProxy.env.yaml` |
| Backend env | `vehapiproxi/.env` (not committed) |

---

## 13. Environment Variables (Critical)

| Variable | Where | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | `vehapiproxi/.env` | Cloud SQL via Auth Proxy (dev) |
| `CLOUD_SQL_CONNECTION_NAME` | Cloud Run | Cloud SQL (prod) |
| `EBSCO_USER` / `EBSCO_PASSWORD` | `vehapiproxi/.env` | Motor EBSCO auth |
| `LIBRARY_BARCODE` | `vehapiproxi/.env` | Motor library card |
| `OPENROUTER_API_KEY` | `vehapiproxi/.env` | Gemini 2.5 Flash via OpenRouter |
| `OPENROUTER_MODEL` | `vehapiproxi/.env` | `google/gemini-2.5-flash` |
| `STRIPE_SECRET_KEY` | `vehapiproxi/.env` | Stripe payments |
| `STRIPE_WEBHOOK_SECRET` | `vehapiproxi/.env` | Stripe webhook validation |
| `MOTOR_FLUIDS_PUBLIC_KEY` / `MOTOR_FLUIDS_PRIVATE_KEY` | `vehapiproxi/.env` | Motor DaaS fluids/parts |
| `OUTBOUND_PROXY_REFRESH_URL` | `vehapiproxi/.env` | Proxy aggregator endpoint |
| `OUTBOUND_PROXY_REFRESH_INTERVAL_MS` | `vehapiproxi/.env` | Pool refresh cadence (180000) |
| `GOOGLE_CLOUD_PROJECT` | `vehapiproxi/.env` | GCP project (`vehapi-torque`) |
| `SKIP_ARTICLE_ACCESS_AUTH` | `vehapiproxi/.env` | Dev-only paywall bypass |
| `NODE_ENV` | `vehapiproxi/.env` | `development` / `production` |
