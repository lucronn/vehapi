# AGENTS.md

> Coding-agent guide for the **Torque** repository — an Angular 19 vehicle-service intelligence app with a Node/Express backend proxy.

## Repository layout

```
/                        # repo root (Angular workspace root)
├── src/                 # Angular 19 frontend
│   ├── app.component.ts # root standalone component
│   ├── pages/           # route-level page components
│   ├── components/      # shared UI components
│   ├── services/        # injectable services (auth, credits, data, AI…)
│   ├── models/          # TypeScript interfaces / schemas
│   ├── utils/           # pure helper functions
│   ├── environments/    # environment.ts / environment.prod.ts
│   └── styles.css       # global Tailwind + design-system tokens
├── vehapiproxi/         # Express backend (proxy only from browser; Stripe, Supabase, AI)
│   ├── src/             # function.js (app), index.js (local dev server), routes/, stripe, credits, supabase…
│   └── API_CONSUMPTION_DOCUMENTATION.md  # upstream/M1 API behavior reference (not a client target)
├── api/                 # Vercel serverless shim → vehapiproxi
├── documentation/       # IMPLEMENTATION_GUIDE.md, VEHAPIPROXI_API_CONSUMPTION.md, DEPLOYMENT.md, AGENT_INSTRUCTIONS…
├── randdev/             # optional / dev utilities (LOGGING, FIREBASE_SETUP, m1_crawler, inject-eruda…)
│   └── m1_crawler/      # Python crawler for year/make/model JSON
├── oldfiles/            # archived/legacy docs + reference artifacts
│   └── _extracted_theme/ # extracted UI kit (reference only)
├── scripts/             # build helpers, OpenAPI export, production checks, automation
├── .cursor/             # Cursor rules and skills (see `.cursor/skills/`)
├── .agents/             # agent rules (gh.md, token_efficiency.md)
├── .github/workflows/   # CI/CD (deploy.yml → Vercel)
├── index.html           # SPA shell
├── index.tsx            # Angular bootstrap + route config
├── angular.json         # Angular CLI config
├── package.json         # npm workspace (name: "torque")
├── tailwind.config.js   # Tailwind v3 with torque design tokens
├── tsconfig.json        # TypeScript config (ES2022, bundler resolution)
├── supabase_schema.sql  # full Supabase DDL (vehicles, articles, users, transactions…)
├── vercel.json          # Vercel rewrites (SPA + /api serverless)
├── proxy.conf.json      # Angular dev proxy → localhost:3001
├── firestore.rules      # Firestore security rules
└── PROGRESS.md          # living status tracker (see "Progress tracking" below)
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | Angular 19 (standalone components, signals, zoneless change detection) |
| Styling | Tailwind CSS 3 + custom design system (`src/styles.css`) — dark-first, mobile-first |
| State management | Angular signals + RxJS observables |
| Routing | Angular Router with `HashLocationStrategy` |
| Backend | Node.js / Express (`vehapiproxi/`) |
| Database | Supabase (PostgreSQL) — auth, article cache, users, credits, transactions |
| Payments | Stripe (checkout, billing portal, webhooks) |
| AI | NVIDIA Nemotron (OpenAI-compatible API) — parsing, rewrite, tutorials, common-issues |
| 3D | Three.js 0.160 (logo torus-knot component) |
| Deployment | Vercel (primary), Netlify, Firebase Hosting (alternatives) |
| CI | GitHub Actions → build + deploy to Vercel on push to `main` |
| Package manager | npm (lockfile committed) |
| Node version | ^22.0.0 |

## Build & run

```bash
npm install              # install dependencies
npm run dev              # ng serve on port 3000 (proxies /api → localhost:3001)
npm run build            # production build → dist/ (then injects Eruda dev-tools)
npm run preview          # ng serve --configuration=production
```

The backend runs separately:

```bash
cd vehapiproxi
cp .env.example .env     # fill in secrets
npm start                # or: node src/index.js — Express (default port from config, often 3001)
```

### Required environment variables (backend)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key |
| `SUPABASE_JWT_SECRET` | JWT verification secret |
| `STRIPE_SANDBOX_SKEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NVIDIA_API_KEY`, `NVAPI_KEY`, or `LLM_API_KEY` | NVIDIA Nemotron / NIM (OpenAI-compatible) — parsing, rewrite, tutorials, common-issues, multimodal. Optional: `LLM_URL`, `LLM_MODEL` / `NEMOTRON_MODEL`, `NEMOTRON_BASE_URL`, `NEMOTRON_VISION_MODEL` — see `vehapiproxi/src/nemotron_client.js` |
| `LIBRARY_BARCODE` / `EBSCO_USER` / `EBSCO_PASSWORD` | Motor API auth credentials |

### Frontend environments

- `src/environments/environment.ts` — dev (`apiUrl: '/api'`)
- `src/environments/environment.prod.ts` — production (absolute Vercel URL)

## Architecture overview

### Frontend (`src/`)

The app uses **standalone Angular components** throughout (no `NgModule`). Key patterns:

- **Signals** for synchronous reactive state (`signal()`, `computed()`, `effect()`).
- **RxJS** for async streams (HTTP, search debounce).
- **Services** are `@Injectable({ providedIn: 'root' })` singletons.

#### Routing (defined in `index.tsx`)

| Path | Component |
|---|---|
| `/` | `HomeComponent` — vehicle selection (year/make/model cascade) |
| `/credits` or `/account` | `CreditsDashboardComponent` — credit balance, purchase, transactions |
| `/vehicle/:contentSource/:vehicleId` | `VehicleDashboardComponent` — tabbed vehicle data (DTC, specs, procedures, diagrams, parts, maintenance, TSB, common issues, component locations) |
| `/vehicle/:contentSource/:vehicleId/article/:articleId` | `ArticleViewerComponent` — article content with AI rewriting |

#### Key services

| Service | Responsibility |
|---|---|
| `AuthService` | Supabase auth (email + Google), signals-based session state |
| `CreditsService` | Credit balance, Stripe checkout/portal, unlock flow |
| `MotorApiService` | HTTP calls to vehapiproxi endpoints |
| `VehicleDataService` | Vehicle metadata resolution |
| `VehiclePersistenceService` | Recent-vehicle persistence |
| `MotorHtmlProcessorService` | HTML content normalization and transformation |
| `AiRewriteService` | AI content rewriting pipeline |
| `DataSyncService` | Background data synchronization |
| `CategoryTreeService` | Category/bucket tree construction |
| `SearchResultsState` | Reactive search state management |
| `ThemeService` | Dark/light theme toggle |
| `WindowManagerService` | Window/panel management |

### Backend (`vehapiproxi/src/`)

Express app that acts as an authenticated proxy to the Motor API and hosts additional services:

| Module | Responsibility |
|---|---|
| `function.js` | Express app — route definitions, Motor API proxy, response interceptor (Vercel/serverless entry) |
| `index.js` | Local dev server — loads auth session, listens on `config.proxyPort` |
| `routes/` | Modular HTTP routes (health, AI, credits, motor-information, …) |
| `stripe.js` | Stripe checkout, portal, webhook, session verification |
| `credits.js` | Credit balance queries, unlock logic, transaction logging |
| `supabase.js` | Supabase client, article/session/user CRUD, caching layer |
| `ai_parser.js` | Nemotron (NVIDIA) — structured parse, rewrite, tutorials, common-issues |
| `nemotron_client.js` | Shared OpenAI-compatible client for Nemotron / NIM |
| `background_worker.js` | Optional long-running normalization / ingest worker |
| `auth.js` | Auth middleware, Motor session + JWT validation |
| `config.js` | Environment config |
| `logger.js` | Winston logger |

### Database schema (Supabase)

Core tables: `vehicles`, `articles`, `system_sessions`, `users`, `transactions`, `ai_processing_logs`, `procedures`, `tsbs`, `dtcs`, `specifications`, `categories`.

RLS is enabled on all tables. Current policies are permissive for MVP — tighten before production.

Full DDL is in `supabase_schema.sql`.

## Data source and normalization (product goal)

**Canonical document:** `documentation/DATA_SOURCE_AND_NORMALIZATION.md` — read it before changing ingest or vehicle read paths.

| Principle | What it means |
|---|---|
| **Supabase is runtime truth** | User-facing reads use Supabase when rows exist for that vehicle. |
| **Motor is ingest / index** | Upstream Motor (via **`vehapiproxi` only**) discovers what exists when Supabase is empty; responses are **normalized and persisted**, not used as an endless parallel “live” source once Supabase is populated for that scope. |
| **First access — catalog** | No catalog/menu in Supabase → ingest Motor **index** data (lists, buckets/silos, metadata) **once**, store normalized rows, then the UI reads **Supabase** for that vehicle’s catalog going forward (except deliberate repair). |
| **Lazy by usage — bodies** | Catalog may list an article without full body. **First open** of that item may fetch from Motor, **normalize, persist**; **later opens** are **Supabase-only**, phasing Motor out of the hot path as the app is used. |

**Agent rules:** `.agents/rules/data-source-supabase-first.md` — short pointer. **Cursor:** `.cursor/rules/data-source-supabase-first.mdc`.

## Coding conventions

### Angular / TypeScript

- **Standalone components only** — never create `NgModule`.
- Use **modern Angular control flow** (`@if`, `@for`, `@switch`) in templates — not `*ngIf` / `*ngFor`.
- Prefer **signals** for local/synchronous state; use **RxJS** for async streams.
- `providedIn: 'root'` for all services.
- Path alias: `@/*` maps to the repo root (`./`).
- Target: ES2022, module: ESNext, bundler resolution.

### Styling

- **Tailwind CSS** utility classes are the default.
- Global design tokens live in `src/styles.css` as CSS custom properties (`--torque-*`).
- Dark mode is the default; light mode via `[data-theme="light"]`.
- Mobile-first: base styles target small screens, `md:` / `lg:` breakpoints enhance for larger viewports.
- Minimum 44px touch targets on all interactive elements.

### Backend (Node.js)

- **ES modules** (`import`/`export`); `"type": "module"` in `vehapiproxi/package.json`.
- Express middleware pattern.
- Winston for structured logging.
- All Supabase access uses the service-role key server-side.

## Testing

Frontend unit tests use **Vitest** with `happy-dom`. Spec files live beside their sources (`*.spec.ts`).

```bash
npm test                 # vitest run
npm run test:watch       # vitest (watch)
npm run test:coverage    # vitest run --coverage
```

Additional test scripts:
- `parity-test.cjs` — compares proxy responses against direct Motor API.
- `scripts/validate_2009_models.cjs` — validates 2009 vehicle model data.

## Deployment

### Primary: Vercel

- GitHub Actions (`.github/workflows/deploy.yml`) builds on push to `main` and deploys via `amondnet/vercel-action`.
- `vercel.json` rewrites `/api/*` to the serverless function and falls back to `index.html` for SPA routing.
- Required secrets in GitHub: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

### Alternatives

- **Netlify** — `netlify.toml` configured (frontend only).
- **Firebase Hosting** — `deploy.bat` + `.firebaserc` (project: `vehapi-torque`).

## Progress tracking

This project uses `PROGRESS.md` at the repo root as the living status document. Any agent completing work **must** update it:

1. Toggle `[ ]` → `[x]` in the Implementation Checklist when finishing an item.
2. Add bugs found to the "Bugs & Known Issues" section.
3. Update "What's Left to Do" when adding or removing scope.
4. Set **Last updated** to today's date.

**Cursor “continue” loop:** per-message auto-loop via hooks is **not reliable** (`stop` often doesn’t fire; `afterAgentResponse` doesn’t consume `followup_message`). Use **`npm run cursor:continue`** for clipboard, or **Windows desktop automation**: root **`npm run cursor:auto-once`** (runs `scripts/continue-once.ps1`), **`npm run cursor:auto-loop`**, optional AutoHotkey — see `scripts/automation/README.md`. Hook toggles **`.cursor/worker-loop.disabled`** / optional **`.cursor/worker-loop.enabled`** / **`.cursor/worker-loop.after-response`** are gitignored; **default ON** when hooks are registered (no flag required for the common case). Details: **`.cursor/WORKER_LOOP.md`**.

Checklist items mirror `documentation/IMPLEMENTATION_GUIDE.md` Section 23.

## Key documentation

| File | What it covers |
|---|---|
| `documentation/IMPLEMENTATION_GUIDE.md` | Comprehensive architecture, algorithms, and implementation specs (~3,400 lines) |
| `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md` | M1/upstream Motor API behavior; long-form proxy consumption notes (Torque calls vehapiproxi only) |
| `documentation/VEHAPIPROXI_API_CONSUMPTION.md` | Torque proxy: routes, auth, CORS vs Motor (companion to the file above) |
| `documentation/DEPLOYMENT.md` | Multi-platform deployment guides; **GitHub Actions and Vercel deploy verification** (two workflows, secrets, post-push checklist) |
| `documentation/DATA_SOURCE_AND_NORMALIZATION.md` | **Supabase vs Motor:** runtime truth, first-touch catalog ingest, lazy per-article normalization, no Motor-fallback display |
| `randdev/LOGGING.md` | Logging standards (reference) |

## Agent rules (`.agents/rules/`)

- **`gh.md`** — always commit, push, and sync changes to GitHub.
- **`token_efficiency.md`** — minimize token usage: search before reading, read targeted ranges, batch edits, skip filler language.
- **`data-source-supabase-first.md`** — short pointer; full contract in `documentation/DATA_SOURCE_AND_NORMALIZATION.md`.

**Cursor skills** (optional deep dives): `.cursor/skills/*/SKILL.md` — e.g. Angular, Stripe, UI/UX mobile-first, vehicle normalization.

## Critical requirements

These are non-negotiable features of the application:

1. **Mobile-first design** — maximize screen space, bottom navigation, 44px touch targets, safe-area insets.
2. **AI content rewriting** — all text content from the Motor API must be AI-rewritten; PDFs and images remain untouched.
3. **Stepper tutorials** — AI-generated interactive step-by-step tutorials from article content, mobile-optimized with swipe navigation.
4. **API proxy** — the SPA uses **`vehapiproxi` only** (`environment.apiUrl` / dev proxy). **Never** call `motor.com`, `api.motor.com`, or `sites.motor.com` from `src/`; upstream Motor is server-side inside the proxy. **Data contract:** Supabase is the **runtime source of truth** once normalized; Motor is **ingest/index** only (see `documentation/DATA_SOURCE_AND_NORMALIZATION.md` — no Motor fallback for display when Supabase should already hold the data).
5. **Credit system** — Stripe-powered credit purchase and module-unlock flow.
