# Release checklist — Torque (paid v1 + L2)

Use before tagging production or after major proxy/DB changes. Repeat critical flows on **mobile width** (under 480px) and **desktop** (1280px and wider).

## Auth & account

- [ ] Sign in (email or Google)
- [ ] Sign out and sign back in (session persists as expected)

## Credits & Stripe (test mode when applicable)

- [ ] Open Credits / Account; balance loads
- [ ] Start checkout for a credit pack; complete or cancel without breaking app state
- [ ] After successful purchase, balance increases (webhook or verify-session path)

## Vehicle & unlock

- [ ] Select year / make / model / engine; land on vehicle dashboard
- [ ] Unlock at least one module (or single article) with credits
- [ ] Open an article from a section; content loads (not SPA shell / wrong shard)
- [ ] **Article lock overlay:** unlock single article, unlock section, **unlock full vehicle** (25 CR), Get Credits — each path completes without stuck state

## Production smoke (about 5 minutes)

After deploy to production:

- [ ] Home loads; year/make/model cascade works (validates metadata cache + `/api/years` → `/years` behavior)
- [ ] Signed-in: vehicle dashboard opens; open one locked article → overlay shows unlock options; after purchase/unlock, article body loads
- [ ] L2: run one semantic search on the vehicle dashboard (empty results OK; no 5xx in network tab)
- [ ] Credits: balance visible; no console errors on `/credits` or checkout open

## Manual full pass (browser)

Use Chrome DevTools or Cursor Browser when available. Stripe **test mode** is fine (`4242…` card). Approx. 15–20 minutes.

1. **Home** — year → make → model → engine; land on vehicle dashboard (hash route).
2. **Dashboard sections** — open each: overview, DTCs, TSBs, procedures, diagrams, component locations, parts, specs/fluids, maintenance, browse-all, common issues. Note any blank panels, stuck spinners, or console errors.
3. **Articles** — open at least one article from a list; confirm HTML or PDF viewer. If AI keys are missing on the API host, you should see an **inline notice** (not a silent failure) on article rewrite; common issues should show an **empty state** explaining AI unavailability.
4. **Credits / Stripe** — open Credits; purchase a pack in test mode; confirm balance updates after return/webhook path.
5. **Unlocks** — unlock one **section** and open a previously locked article; try **common issues** unlock (no browser `alert`/`confirm`; insufficient credits is shown under the button).
6. **Network sanity** — `articles` REST should not 400 after `documentation/migrations/20260326_articles_code_description.sql` on Supabase; `/api/rewrite` and `/api/common-issues/generate` should not return **503** once `NVIDIA_API_KEY` or `LLM_API_KEY` is set on Vercel.

## L2 search (when enabled)

- [ ] Dev: `environment.features.l2Search === true` — run a semantic query on the vehicle dashboard; results or empty state without 5xx
- [ ] Prod: only after DB migrations (`match_content_chunks` RPC) and `l2Search` flag enabled

## Automated local checks (no secrets)

From repo root:

```bash
npm run verify:prod-readiness
```

Runs `npm run build` plus `node --check` on critical `vehapiproxi` entrypoints (proxy, worker, L2, Stripe, rate limit).

- [ ] `npm run verify:prod-readiness` passes on Node 22 locally or in CI

## Regression scripts (developer)

```bash
cd vehapiproxi
npm run verify:release-target
npm run verify:evidence-links -- --local
npm run verify:golden-vehicles -- --local
```

Requires local proxy + `.env` per `PROGRESS.md` (or use `--token` / remote `--proxy` against deployed API).

- [ ] `cd vehapiproxi && npm run verify:release-target` passes against the target DB
- [ ] `cd vehapiproxi && npm run verify:golden-vehicles -- --local` (or remote equivalent) produces a passing report under `documentation/release-artifacts/`

## Deploy

- [ ] `main` builds in CI (Angular + any backend workflow)
- [ ] CI release gate runs on Node 22 and executes `npm run verify:prod-readiness`
- [ ] Vercel env: `SUPABASE_*`, Stripe, Motor credentials, embedding vars if using L2
- [ ] DB migrations applied in target environment before release: RLS tightening, `match_content_chunks` RPC, and any pending normalization/L2 migrations

## Rollback

- [ ] Note last good Vercel deployment; use **Instant Rollback** if a release breaks auth or payments
