# Project Progress

**Last updated:** 2025-02-26 (Stripe portal + dashboard)  
**Reference:** `documentation/IMPLEMENTATION_GUIDE.md` Section 23 (Implementation Checklist); credits/Stripe are project-specific (not in doc).

This file is the single source of truth for project status. Update it whenever you complete work, find bugs, or change scope. See `.cursor/rules/progress-update.mdc` for the rule that enforces keeping this file current.

---

## Summary

| Area              | Status   | Notes |
|-------------------|----------|--------|
| Core app          | ✅ Done  | Angular 21, hash routing, auth, theme |
| Vehicle dashboard | ✅ Done  | Sections: procedures, parts, maintenance, diagrams, TSB, DTC, specs, component locations |
| Credits dashboard | ✅ Done  | `/credits`, `/account`: balance, buy credits, vehicles, receipts tabs |
| Stripe / payments | ✅ Done  | Checkout session, webhook, add credits; vehapiproxi `/api/credits/*` |
| Supabase / data lake | ⚠️ Partial | Auth + normalized AI data cached in Supabase; read path & UI features not fully wired |
| Article viewer    | ✅ Done  | HTML/PDF, image viewer modal |
| API & proxy       | ✅ Done  | Motor API, vehapiproxi proxy, vehicle data service |
| AI features       | ❌ Gaps  | Content rewriting not implemented; stepper UI only, no AI generation |
| Mobile-first      | ⚠️ Partial | Responsive layout; bottom nav/slide-out/safe areas not verified |
| Testing           | ⚠️ Partial | Some specs exist; full checklist not covered |

---

## Implementation Checklist (vs Section 23)

### Core Infrastructure

- [x] API client setup with proxy endpoint
- [x] HTTP client configuration
- [x] Error handling infrastructure
- [x] State management (vehicle data, search, section strategies)
- [x] Routing with URL state (hash: `#/vehicle/:contentSource/:vehicleId`, article trail)

### Mobile-First Design

- [ ] Mobile-first responsive design system — *layout exists; not verified against 100vw/100vh, safe areas*
- [ ] Viewport configuration (100vw/100vh, safe areas)
- [ ] Touch-optimized controls (44x44px minimum)
- [ ] Bottom navigation bar
- [ ] Slide-out menu
- [ ] Safe area support
- [ ] Touch gesture support
- [ ] Mobile-optimized layouts

### AI Integration (CRITICAL per docs)

- [ ] AI content rewriting integration
- [ ] AI rewriting pipeline (extract → rewrite → merge)
- [ ] AI rewriting caching strategy
- [ ] AI rewriting fallback handling
- [ ] Stepper tutorial **generation** system — *UI exists (`app-tutorial-stepper`), no AI generation*
- [x] Tutorial UI components (display only)
- [x] Tutorial progress tracking (prev/next in component)

### Core Features

- [x] Search functionality (dashboard search, section-level)
- [x] Article display system (without AI rewriting)
- [x] Vehicle selection (Year/Make/Model via home flow)
- [ ] VIN lookup — *not verified*
- [ ] Motor vehicle selection — *not verified*
- [x] Maintenance schedules (section + indicators)
- [x] Parts management (section)
- [x] Labor operations (via procedures/articles)
- [ ] Bookmarks (save/get) — *not verified*
- [ ] User settings loading — *not verified*

### Credits / Dashboard / Stripe / Payments

- [x] Credits dashboard page (`/credits`, `/account`) — balance, overview, vehicles, receipts, buy
- [x] CreditsService (frontend) — balance, unlock module, API base (vehapiproxi or relative)
- [x] vehapiproxi credits API — `balance`, `checkout`, `unlock`, `transactions`, `webhook`
- [x] Stripe checkout — create session, success/cancel redirect to `/#/account`
- [x] Stripe webhook — `checkout.session.completed` → addCredits, setStripeCustomerId
- [x] Per-section paywall — procedures, parts, maintenance, diagrams, TSB, DTC, specs, component locations, common issues (unlock with CR)
- [x] Transaction logging — logTransaction, addCredits with stripe session/intent and usdCents
- [x] Stripe Customer Portal / billing management — `POST /api/credits/portal`, Billing button and link on credits dashboard

### Supabase / Data Caching & AI Data Lake

- [x] Supabase JS client and auth service (`SupabaseService`, `AuthService`) for user identity and sessions
- [x] Normalized schema models for AI data (`src/models/normalized_schema.ts`)
- [x] Supabase REST helper in proxy (`vehapiproxi/src/supabase.js`) for `insertParsedData`, `logAiProcessing`, `checkParsedArticle`
- [x] Background worker (`vehapiproxi/src/background_worker.js`) to parse Motor responses with AI and persist normalized rows (procedures, DTCs, TSBs, specs) into Supabase
- [ ] Read path that prefers Supabase cached procedures via `checkParsedArticle` before falling back to live Motor API — *plumbing exists; integration not fully wired/verified*
- [ ] Frontend features powered directly by normalized Supabase data (e.g. AI tutorials, richer search) — *blocked on AI integration work above*

### UI Components

- [x] Layout (header, sidebar, content)
- [x] Article display (HTML, iframe, PDF)
- [x] Search results / section lists
- [x] Vehicle selector (home flow)
- [x] Maintenance schedule components
- [x] Parts selector components
- [x] Tutorial stepper component (display only)
- [x] Credits dashboard (balance, buy, vehicles, receipts)
- [x] Loading indicators / skeletons
- [x] Error / empty states

### State Management

- [x] Search results / section data
- [x] Vehicle selection (route params)
- [x] Section strategies and asset loading
- [ ] Filter tabs store — *part of vehicle data; not separate store*
- [ ] Dedicated facades per feature — *service layer exists, not formal facades*
- [ ] Queries for derived state — *computed in components*

### Data Processing

- [x] Bucket organization / section strategies
- [x] Article filtering
- [x] HTML transformation (motor-html-processor, html-processing)
- [ ] Navigation attribute calculation — *not verified*
- [ ] AI rewriting integration
- [ ] Tutorial generation integration

### Performance

- [x] Section-level loading and strategies
- [ ] Debouncing / distinctUntilChanged — *not verified*
- [ ] Lazy loading (routes/components) — *all routes eager*
- [ ] Change detection optimization — *OnPush used in places*
- [ ] Request deduplication
- [ ] Image optimization
- [ ] Code splitting
- [ ] Caching strategies (beyond browser)

### Testing

- [ ] API integration testing
- [ ] State management testing
- [ ] Component testing — *some specs (vehicle-dashboard, home, motor-api, etc.)*
- [ ] Routing testing
- [ ] Error scenario testing
- [ ] Mobile device testing
- [ ] AI rewriting testing
- [ ] Tutorial generation testing
- [ ] Performance testing
- [ ] Accessibility testing

---

## Bugs & Known Issues

1. **DEBUG logging in production path**  
   `src/services/vehicle-data.service.ts` (around line 447): `console.log` for bucket diagnostics. Should be behind a debug flag or removed for production.

2. **Common Issues section empty**  
   `GeminiService` was removed; `common-issues-section` intentionally does not load AI-generated issues. Section shows empty. Either re-enable AI (Gemini or other) or hide/repurpose the section.

3. **Wildcard route**  
   `index.tsx`: `path: '**'` uses `pathMatch: 'full'`; typically `pathMatch: 'prefix'` is used for catch-all. Verify 404 behavior.

---

## Unfinished / Stub Components

| Component / area        | State |
|-------------------------|--------|
| Common Issues section   | AI removed; section empty, no replacement |
| AI content rewriting     | Not implemented (docs say critical) |
| AI stepper generation   | Only display component; no pipeline from article → steps |
| VIN lookup              | Not verified in UI |
| Bookmarks               | Not verified |
| User settings API        | Not verified |
| vehapiproxi debug API   | Requires `DEBUG_API_KEY`; optional |
| Stripe Customer Portal | Done — portal session + Billing button on account page |

---

## What’s Left to Do (Priority)

1. **High:** Implement or re-enable AI content rewriting (or document decision to defer).
2. **High:** Wire AI-generated stepper tutorials (or document deferral).
3. **Medium:** Revisit Common Issues: restore Gemini/another provider or remove section.
4. **Medium:** Remove or guard DEBUG logs in `vehicle-data.service.ts`.
5. **Medium:** Verify and complete mobile-first checklist (viewport, touch targets, bottom nav, slide-out).
6. **Low:** Verify VIN lookup, bookmarks, user settings.
7. **Low:** Add tests for API, state, routing, error cases.
8. **Low:** Lazy routes and code splitting where useful.

---

## How to Update This File

- **When completing a feature:** Change the relevant `[ ]` to `[x]` and add a short note if needed.
- **When finding a bug:** Add it under **Bugs & Known Issues** with file and line or component.
- **When adding/removing scope:** Update **Unfinished / Stub Components** and **What’s Left to Do**.
- **On significant updates:** Bump **Last updated** at the top.
