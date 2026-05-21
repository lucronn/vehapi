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
├── vehapiproxi/         # Express backend (proxy only from browser; Stripe, Cloud SQL, AI)
│   ├── src/             # function.js (entry), routes/, swagger.json, stripe, credits, db, db.service…
│   └── API_CONSUMPTION_DOCUMENTATION.md  # upstream/M1 API behavior reference (not a client target)
├── documentation/       # IMPLEMENTATION_GUIDE.md, VEHAPIPROXI_API_CONSUMPTION.md, DEPLOYMENT.md, AGENT_INSTRUCTIONS…
├── vehapiproxi/         # API_CONSUMPTION_DOCUMENTATION.md (Motor proxy reference)
├── randdev/             # optional / archived tooling (LOGGING, FIREBASE_SETUP, old crawler data)
├── scripts/             # build helpers (inject-eruda, validate models)
├── tools/               # optional dev utilities (e.g. `normalization_tui` — Python monitor for proxy)
├── randdev/             # Dev utilities (crawler data)
│   └── m1_crawler/     # Python crawler for year/make/model JSON
 ├── oldfiles/           # Archived/legacy docs + reference artifacts
 │   └── _extracted_theme/  # extracted UI kit (reference only)
├── .cursor/             # Cursor rules and skills
├── .agents/             # agent rules (gh.md, token_efficiency.md)
├── .github/workflows/   # CI/CD (deploy.yml → Firebase/Cloud Run)
├── index.html           # SPA shell
├── index.tsx            # Angular bootstrap + route config
├── angular.json         # Angular CLI config
├── package.json         # npm workspace (name: "torque")
├── tailwind.config.js   # Tailwind v3 with torque design tokens
├── tsconfig.json        # TypeScript config (ES2022, bundler resolution)
├── proxy.conf.json      # Angular dev proxy → localhost:3001
├── firestore.rules      # Firestore security rules
└── PROGRESS.md          # living status tracker (see "Progress tracking" below)
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | Angular 19 (standalone components, signals, zoneless change detection) |
| Styling | Tailwind CSS 3 + custom design system (`src/styles.css`) — light-first, minimalist |
| State management | Angular signals + RxJS observables |
| Routing | Angular Router with `HashLocationStrategy` |
| Backend | Node.js / Express (`vehapiproxi/`) |
| Database | Cloud SQL (PostgreSQL) — auth caching, article cache, users, credits, transactions |
| Payments | Stripe (checkout, billing portal, webhooks) |
| AI | NVIDIA Nemotron (OpenAI-compatible API) — parsing, rewrite, tutorials, common-issues |
| 3D | Three.js 0.160 (logo torus-knot component) |
| Deployment | Google Cloud Run (Backend), Firebase Hosting (Frontend) |
| CI | GitHub Actions → build + deploy to Google Cloud on push to `main` |
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
node src/index.js        # Express on port 3001
```

### Required environment variables (backend)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL URI for local development database |
| `CLOUD_SQL_CONNECTION_NAME` | Connection name (e.g. `project:region:db`) for Cloud Run |
| `DB_NAME` | Database name for Cloud Run connection |
| `DB_USER` | Database user for Cloud Run connection |
| `DB_PASSWORD` | Database password for Cloud Run connection |
| `STRIPE_SANDBOX_SKEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NVIDIA_API_KEY` (or `LLM_API_KEY`) | NVIDIA API key (Nemotron — parsing, rewrite, tutorials, common-issues). Optional: `LLM_URL` (e.g. `.../v1/chat/completions` → base for SDK), `LLM_MODEL` / `NEMOTRON_MODEL`, `NEMOTRON_BASE_URL` — see `vehapiproxi/src/nemotron_client.js` |
| `LIBRARY_BARCODE` / `EBSCO_USER` / `EBSCO_PASSWORD` | Motor API auth credentials |

### Frontend environments

- `src/environments/environment.ts` — dev (`apiUrl: '/api'`)
- `src/environments/environment.prod.ts` — production (Firebase Hosting / Cloud Run endpoints mapped to `/api`)

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
| `AuthService` | Firebase/Supabase auth proxy, signals-based session state |
| `CreditsService` | Credit balance, Stripe checkout/portal, unlock flow |
| `MotorApiService` | HTTP calls to vehapiproxi endpoints |
| `VehicleDataService` | Vehicle metadata resolution |
| `VehiclePersistenceService` | Recent-vehicle persistence |
| `MotorHtmlProcessorService` | HTML content normalization and transformation |
| `AiRewriteService` | AI content rewriting pipeline |
| `DataSyncService` | Background data synchronization |
| `SearchResultsState` | Reactive search state management |
| `ThemeService` | Theme toggle service |
| `WindowManagerService` | Window/panel management |

### Backend (`vehapiproxi/src/`)

Express app that acts as an authenticated proxy to the Motor API and hosts additional services:

| Module | Responsibility |
|---|---|
| `function.js` | Express app entry — route definitions, Motor API proxy, response interceptor |
| `stripe.js` | Stripe checkout, portal, webhook, session verification |
| `credits.js` | Credit balance queries, unlock logic, transaction logging |
| `db.js` | Cloud SQL PostgreSQL database connection pool |
| `db.service.js` | Article/session/user CRUD, database caching layer |
| `ai_parser.js` | Google GenAI integration — content rewrite, tutorial generation, common-issues generation |
| `auth.js` | Auth middleware, Firebase JWT validation |
| `config.js` | Environment config |
| `logger.js` | Winston logger |

### Database schema (Cloud SQL)

Core tables: `vehicles`, `articles`, `system_sessions`, `users`, `transactions`, `ai_processing_logs`, `procedures`, `tsbs`, `dtcs`, `specifications`, `categories`.

Full DDL is in `cloudsql_schema.sql`.

## Data source and normalization (product goal)

**Canonical document:** `documentation/DATA_SOURCE_AND_NORMALIZATION.md` — read it before changing ingest or vehicle read paths.

| Principle | What it means |
|---|---|
| **Database is runtime truth** | User-facing reads use Cloud SQL database when rows exist for that vehicle. |
| **Motor is ingest / index** | Upstream Motor (via **`vehapiproxi` only**) discovers what exists when database is empty; responses are **normalized and persisted**, not used as an endless parallel “live” source once database is populated for that scope. |
| **First access — catalog** | No catalog/menu in database → ingest Motor **index** data (lists, buckets/silos, metadata) **once**, store normalized rows, then the UI reads **database** for that vehicle’s catalog going forward (except deliberate repair). |
| **Lazy by usage — bodies** | Catalog may list an article without full body. **First open** of that item may fetch from Motor, **normalize, persist**; **later opens** are **database-only**, phasing Motor out of the hot path as the app is used. |

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
- Minimalist terracotta theme is the default.
- Mobile-first: base styles target small screens, `md:` / `lg:` breakpoints enhance for larger viewports.
- Minimum 44px touch targets on all interactive elements.

### Backend (Node.js)

- CommonJS modules (`require`/`module.exports`) or ES6 modules (`import`/`export`) as configured.
- Express middleware pattern.
- Winston for structured logging.

## Testing

Tests use Angular test utilities with `happy-dom` as the DOM implementation. Spec files live beside their source files (`*.spec.ts`).

Additional test scripts:
- `parity-test.cjs` — compares proxy responses against direct Motor API.
- `scripts/validate_2009_models.cjs` — validates 2009 vehicle model data.

## Deployment

### Primary: Google Cloud (Cloud Run & Firebase Hosting)

- GitHub Actions build and deploy via Vercel / Google Cloud deployment scripts.
- Firebase Hosting acts as the frontend client shell, rewrites `/api/*` requests directly to Google Cloud Run backend instances.

## Key documentation

| File | What it covers |
|---|---|
| `documentation/IMPLEMENTATION_GUIDE.md` | Comprehensive architecture, algorithms, and implementation specs |
| `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md` | M1/upstream API behavior reference (Torque calls vehapiproxi only) |
| `documentation/VEHAPIPROXI_API_CONSUMPTION.md` | Torque proxy: routes, auth, CORS vs Motor (companion to `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`) |
| `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md` | Long-form Motor API / proxy consumption notes |
| `documentation/DEPLOYMENT.md` | Deployment guides for Google Cloud stack |
| `documentation/DATA_SOURCE_AND_NORMALIZATION.md` | **Database vs Motor:** runtime truth, first-touch catalog ingest, lazy per-article normalization, no Motor-fallback display |
| `randdev/LOGGING.md` | Logging standards (reference) |

## Agent rules (`.agents/rules/`)

- **`gh.md`** — always commit, push, and sync changes to GitHub.
- **`token_efficiency.md`** — minimize token usage: search before reading, read targeted ranges, batch edits, skip filler language.

## Critical requirements

These are non-negotiable features of the application:

1. **Mobile-first design** — maximize screen space, bottom navigation, 44px touch targets, safe-area insets.
2. **AI content rewriting** — all text content from the Motor API must be AI-rewritten; PDFs and images remain untouched.
3. **Stepper tutorials** — AI-generated interactive step-by-step tutorials from article content, mobile-optimized with swipe navigation.
4. **API proxy** — the SPA uses **`vehapiproxi` only** (`environment.apiUrl` / dev proxy). **Never** call `motor.com`, `api.motor.com`, or `sites.motor.com` from `src/`; upstream Motor is server-side inside the proxy. **Data contract:** Database is the **runtime source of truth** once normalized; Motor is **ingest/index** only (see `documentation/DATA_SOURCE_AND_NORMALIZATION.md` — no Motor fallback for display when DB should already hold the data).
5. **Credit system** — Stripe-powered credit purchase and module-unlock flow.
