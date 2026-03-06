# Project Progress

**Last updated:** 2026-03-05 (Palette: dashboard sign-out button a11y)  
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
| Supabase / data lake | ⚠️ Partial | Auth + normalized AI data cached in Supabase with UPSERT, dedup, unique constraints; read path & UI features not fully wired |
| Article viewer    | ✅ Done  | HTML/PDF, image viewer modal |
| API & proxy       | ✅ Done  | Motor API, vehapiproxi proxy, vehicle data service |
| AI features       | ⚠️ Partial | `/api/rewrite` and `/api/tutorials/generate` endpoints added to proxy; `AiRewriteService` wired into article viewer; Common Issues still empty (AI deferred) |
| Mobile-first      | ⚠️ Partial | Credits dashboard: 44px tap targets, card layout on mobile; bottom nav/slide-out not verified |
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

- [x] AI content rewriting integration — `AiRewriteService` + `/api/rewrite` proxy endpoint (Gemini); progressive enhancement in article viewer
- [x] AI rewriting pipeline (extract → rewrite → merge) — proxy rewrites HTML text, preserving tags/images/PDFs
- [x] AI rewriting caching strategy — falls back to original content on failure; server-side (no client-side cache yet)
- [x] AI rewriting fallback handling — original HTML shown immediately; rewrite applied when ready
- [x] Stepper tutorial **generation** system — `generateTutorialSteps` in proxy + `AiRewriteService.generateTutorialSteps` + "Start Tutorial" button in article viewer
- [x] Tutorial UI components (display only)
- [x] Tutorial progress tracking (prev/next in component)

### Core Features

- [x] Search functionality (dashboard search, section-level)
- [x] Article display system (with AI rewriting — progressive enhancement)
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
- [x] Credits dashboard UX polish — auth-first purchase flow (modal instead of forced Google), `lastError` banner for checkout/portal failures, fetch balance+transactions only when logged in
- [x] Credits dashboard mobile — card layout for history on small screens, min 44px tap targets, touch-manipulation, billing portal return to `/#/credits`

### Supabase / Data Caching & AI Data Lake

- [x] Supabase JS client and auth service (`SupabaseService`, `AuthService`) for user identity and sessions
- [x] Normalized schema models for AI data (`src/models/normalized_schema.ts`)
- [x] Supabase REST helper in proxy (`vehapiproxi/src/supabase.js`) for `insertParsedData` (UPSERT with conflict resolution), `logAiProcessing`, `checkParsedArticle`, `wasAlreadyParsed`
- [x] Background worker (`vehapiproxi/src/background_worker.js`) to parse Motor responses with AI and persist normalized rows — dedup check before AI call, `external_id` for all types, skip if no `vehicle_id`
- [x] Unique constraints on Supabase tables (`procedures`, `tsbs`, `dtcs`, `specifications`) to prevent duplicate rows at DB level
- [x] Gemini retry with exponential backoff on 429 rate-limit errors (up to 3 retries)
- [x] AI data limit increased from 8k to 30k chars to reduce data truncation loss
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
- [x] AI rewriting integration — `/api/rewrite` proxy endpoint + `AiRewriteService`
- [x] Tutorial generation integration — `/api/tutorials/generate` proxy endpoint + `AiRewriteService`

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

1. **Common Issues section empty**  
   `GeminiService` was removed; `common-issues-section` intentionally does not load AI-generated issues. Section shows empty. Either re-enable AI (Gemini or other) or hide/repurpose the section. Deferred — lower priority than article-level rewriting.

2. **Wildcard route**  
   `index.tsx`: `path: '**'` uses `pathMatch: 'full'`; typically `pathMatch: 'prefix'` is used for catch-all. Verify 404 behavior.

3. **AI rewriting — server-side only**  
   `/api/rewrite` and `/api/tutorials/generate` require `GEMINI_API_KEY` to be set in the vehapiproxi environment. If missing, the endpoints return 503 and the article viewer falls back to original content gracefully.

4. **~Resolved~ AI parsing high failure rate**  
   Was 61% failure (71/116 tasks) due to: (a) Gemini 429 rate-limit with no retry, (b) Vercel freeze killing fire-and-forget tasks, (c) duplicate work consuming quota. Fixed with retry+backoff, dedup check before AI call, and data limit increase. Vercel freeze is inherent to hobby tier.

5. **~Resolved~ Mobile black screen after purchase redirect**  
   After Stripe redirect on mobile, users saw a black screen. Fixed with: (a) canonical frontend URL in Stripe success/cancel URLs (`VEHAPI_URL` fallback when origin unreliable), (b) body background in `index.html` so page is never blank, (c) immediate "Completing your purchase…" banner in credits dashboard when `purchase=success` is detected.

---

## Unfinished / Stub Components

| Component / area        | State |
|-------------------------|--------|
| Common Issues section   | AI removed; section empty, no replacement |
| VIN lookup              | Not verified in UI |
| Bookmarks               | Not verified |
| User settings API        | Not verified |
| vehapiproxi debug API   | Requires `DEBUG_API_KEY`; optional |
| Stripe Customer Portal | Done — portal session + Billing button on account page |

---

## What's Left to Do (Priority)

1. **Medium:** Revisit Common Issues: restore Gemini/another provider or remove section.
2. **Medium:** Verify and complete mobile-first checklist (viewport, touch targets, bottom nav, slide-out).
3. **Low:** Verify VIN lookup, bookmarks, user settings.
4. **Low:** Add tests for API, state, routing, error cases.
5. **Low:** Lazy routes and code splitting where useful.
6. **Low:** Server-side caching for AI rewritten content (Redis or Supabase) to avoid re-rewriting the same article.

---

## How to Update This File

- **When completing a feature:** Change the relevant `[ ]` to `[x]` and add a short note if needed.
- **When finding a bug:** Add it under **Bugs & Known Issues** with file and line or component.
- **When adding/removing scope:** Update **Unfinished / Stub Components** and **What's Left to Do**.
- **On significant updates:** Bump **Last updated** at the top.
