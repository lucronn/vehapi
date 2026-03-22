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
npm run verify:evidence-links -- --local
```

Requires local proxy + `.env` per `PROGRESS.md` (or use `--token` against deployed API).

## Deploy

- [ ] `main` builds in CI (Angular + any backend workflow)
- [ ] CI release gate runs on Node 22 and executes `npm run verify:prod-readiness`
- [ ] Vercel env: `SUPABASE_*`, Stripe, Motor credentials, embedding vars if using L2
- [ ] DB migrations applied in target environment before release: RLS tightening, `match_content_chunks` RPC, and any pending normalization/L2 migrations

## Rollback

- [ ] Note last good Vercel deployment; use **Instant Rollback** if a release breaks auth or payments
