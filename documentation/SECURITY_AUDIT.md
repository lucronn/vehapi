# Security audit — 2026-03-26 (Track B5)

Scope: CORS, response headers on the SPA host, Angular auth token handling, and tracked secrets. Backend: `vehapiproxi/src/function.js`. Frontend edge: `vercel.json`.

## 1. CORS allowlist (`vehapiproxi/src/function.js`)

### What was checked

- Credentialed CORS uses explicit origin reflection (`cors` package + `corsOptionsDelegate`); no `*` for browser cross-origin requests with credentials.
- Defaults: production Torque URLs (`https://vehapi.vercel.app`, `https://vehapiproxi.vercel.app`), merge of `CORS_ALLOWED_ORIGINS` / `ALLOWED_ORIGINS`, and `https://${VERCEL_URL}` when `VERCEL_URL` is set (Vercel deployments).

### Findings

- **Good:** Wildcard is not used for credentialed browser traffic; unknown origins get `origin: false`.
- **Issue (fixed):** `http://localhost:3000` and `http://127.0.0.1:3000` were always in the allowlist, including on Vercel. That widened the cross-origin surface if an attacker could somehow get a browser to treat a malicious page as same “logical” dev (unlikely but unnecessary).

### What changed

- Localhost / 127.0.0.1 origins are added only when **not** running on Vercel (`VERCEL !== '1'`) and **`NODE_ENV` is not `production`**. Production/Vercel deployments rely on the fixed `.vercel.app` hosts, `VERCEL_URL`, and `CORS_ALLOWED_ORIGINS` for extra domains.

### Documentation

- `vehapiproxi/.env.example` documents `CORS_ALLOWED_ORIGINS` and the localhost vs Vercel behavior.

### Manual action

- For custom production domains, set `CORS_ALLOWED_ORIGINS` in the Vercel project environment (comma- or space-separated origins).

---

## 2. CSP and security headers

### What was checked

- `vehapiproxi/src/function.js`: no `Content-Security-Policy` header (API/serverless responses only; acceptable for this pass).
- `vercel.json`: previously had rewrites/functions only.

### Findings

- No CSP on the static SPA host (intentionally not added here — a full CSP needs app testing against inline scripts, Angular, Stripe, Supabase, etc.).

### What changed

- Added **basic** security headers on all routes in `vercel.json`:

  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`

These apply to the Angular shell and static assets served by Vercel. API routes still go through the same host; API responses may also receive these headers (usually harmless).

### Manual action

- After stabilization, consider a stricter CSP for the SPA (nonce/hash for any required inline scripts, allowlists for Supabase/Stripe/third-party scripts).

---

## 3. Auth token handling (`src/interceptors/auth-header.interceptor.ts`)

### What was checked

- Which paths receive the Supabase `Authorization: Bearer` header.
- Whether tokens could be sent to unintended hosts.
- Session refresh behavior.

### Findings

- **Good — scoping:** The interceptor attaches the Bearer token only when the request path matches:

  - `/api/credits/*`
  - Article content routes: `/api/source/.../vehicle/.../article/...` (optional `/html`, `/metadata`)
  - L2: `/api/l2/search`, `/api/l2/*`, `/api/vehicle/.../l2/search`
  - `/api/motor-information/*`

  Other `/api/source/*` Motor-proxy paths intentionally **do not** get the Supabase header (avoids Motor 401s when both cookie jar and Bearer are present).

- **Good — host:** `HttpClient` uses `environment.apiUrl` (same-origin `/api` in dev or configured API origin). The interceptor does not add auth to arbitrary third-party URLs.

- **Good — refresh:** `AuthService.getIdToken()` (used by the interceptor) calls `getSession()`, hydrates state, and calls `refreshSession()` when the access token expires within 60 seconds (`auth.service.ts`).

### What changed

- None required for this audit.

---

## 4. Secrets in repository files

### What was checked

- Grep for Stripe key prefixes (`sk_test_`, `pk_test_`, `sk_live_`, `pk_live_`).
- `password=` / `secret=` in non-`.env` sources (with focus on accidental commits).

### Findings

- **`vehapiproxi/.env.vercel.prod.check` (sanitized):** Previously contained real Stripe test secret, Supabase **service role** JWT, webhook signing secret, anon keys, and a Vercel OIDC token. This was inappropriate for version control.

### What changed

- File replaced with a **placeholder-only** template and paths added to `.gitignore` (`vehapiproxi/.env.vercel.prod.check`, `vehapiproxi/.env*.local`) so CLI-generated snapshots are not re-committed.

- **`vehapiproxi/src/auth.js`:** Query string uses `encodeURIComponent(ebscoPassword)` from **environment variables** (`EBSCO_PASSWORD`) — not a hardcoded secret (aligns with prior B2 work).

### Manual action — credential rotation (required if the leaked file was ever pushed)

If `vehapiproxi/.env.vercel.prod.check` with real values existed on a remote or shared history:

1. **Stripe:** Rotate the secret key in [Stripe Dashboard](https://dashboard.stripe.com/apikeys); update Vercel env `STRIPE_SANDBOX_SKEY` / `STRIPE_SECRET_KEY` as used by the project.
2. **Supabase:** Rotate the **service role** key (Dashboard → Settings → API); update server env. Consider whether the **JWT secret** or other keys need rotation if exposed.
3. **Stripe webhooks:** If `STRIPE_WEBHOOK_SECRET` was exposed, create a new signing secret for the endpoint and update env.
4. **Git history:** Secrets may remain in old commits. Options: `git filter-repo` / BFG to purge the file from history, or accept risk and rely on rotation. Prefer rotation + history cleanup for a public repo.

---

## 5. Verification commands run

- `node --check vehapiproxi/src/function.js` — after CORS edits.
- `npm run build` — after changes touching the workspace (recommended).

---

## 6. RLS policy migration (applied 2026-03-26)

`documentation/migrations/20260326_rls_tightening.sql` was executed against the Supabase production project (`jzwhcoivwzumqrfscnlw`) via `execute_sql`.

- **Group A (18 tables):** Old `Allow all …` policies dropped; replaced with `Read-only … FOR SELECT USING (true)`. Tables: `vehicles`, `articles`, `procedures`, `procedure_step`, `procedure_tool`, `procedure_part`, `tsbs`, `dtcs`, `specifications`, `spec_fact`, `categories`, `vehicle_metadata`, `parts`, `maintenance_schedules`, `maintenance_task`, `canonical_bucket`, `bucket_alias`, `common_issues_cache`.
- **Group B (2 tables):** `ai_processing_logs`, `failed_extractions` — policies dropped, no replacement → default deny for `anon`/`authenticated`.
- **Not in scope:** `system_sessions`, `transactions`, `users` (retain existing policies); `content_item` (still has legacy `Allow all` — tighten separately if needed).
- **Verification:** `SELECT schemaname, tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public'` confirmed all 18 Group A tables show `Read-only … / SELECT` and Group B tables have no policies.

---

## Summary

| Area            | Status |
|----------------|--------|
| CORS           | Tightened: no localhost on Vercel/production mode |
| Vercel headers | Added nosniff, frame deny, referrer policy |
| Auth tokens    | Confirmed path-scoped; refresh in `getIdToken()` |
| Leaked env file| Sanitized + gitignore; **rotate keys if ever shared** |
| RLS policies   | Applied to production; 18 tables read-only, 2 default-deny |
