# vehapiproxi — API consumption (Torque proxy)

**Last updated**: 2026-03-20  

This document describes how **clients consume the Express proxy** in `vehapiproxi/`: first-party routes, authentication, CORS, and how requests reach the upstream Motor API.

For **M1/upstream** behavior (query params, `searchTerm`, labor IDs, maintenance frequency codes, etc.), use **`vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`** (backend-side reference; Torque never calls Motor directly). For **OpenAPI paths and schemas**, use **`vehapiproxi/src/swagger.json`** and optional **`GET /docs`** (Swagger UI) on a running server.

---

## 1. Roles

| Piece | Responsibility |
|--------|------------------|
| **Torque Angular app** | Calls the proxy over HTTPS; uses Supabase session JWT where required. |
| **vehapiproxi** | Injects Motor session cookies, proxies to `sites.motor.com/m1`, adds credits/AI/Supabase-backed routes, enforces article access, caches. |
| **Upstream Motor** | Authoritative vehicle/article API; browser must not call it directly. |

---

## 2. Base URLs

| Environment | Typical base |
|-------------|----------------|
| **Local dev** | Angular `http://localhost:3000` with `proxy.conf.json` → **`/api`** (same origin; proxy forwards to `vehapiproxi`). |
| **Production** | Absolute proxy URL from `environment.prod.ts` (e.g. `https://…vercel.app/api`) **or** dedicated **`https://vehapiproxi.vercel.app`** for routes that are not under the SPA’s `/api` prefix (see below). |

**Path prefixes**

- Most Motor-shaped routes are under **`/api/...`** (e.g. `/api/years`, `/api/source/MOTOR/vehicle/.../articles/v2`).
- **Credits, AI, article metadata** use **`/api/credits/*`**, **`/api/rewrite`**, etc.
- **Motor session helpers** (no `/api` prefix): **`/health`**, **`/auth/status`**, **`/auth/start`**.
- **Debug** (keyed): **`/debug/*`**.

---

## 3. CORS and browser credentials

The proxy uses an **allowlist** of `Origin` values (see `vehapiproxi/src/function.js`). Browsers must send the real origin; responses use **`Access-Control-Allow-Credentials: true`** and a **specific** `Access-Control-Allow-Origin` (not `*`) when the origin is allowed.

**Allowed origins (as implemented)** include:

- `https://vehapi.vercel.app`
- `https://vehapiproxi.vercel.app`
- `http://localhost:3000`

Add new production origins in code if you deploy the SPA elsewhere.

---

## 4. Two authentication layers

### 4.1 Upstream Motor session (server-side, automatic)

For routes that hit the **proxy middleware**, `authMiddleware` ensures a valid Motor session (memory / Firestore / re-auth), then sets:

- `Cookie` (Motor cookies)
- `User-Agent`, `Referer`, `X-Requested-With` as expected by upstream

The **browser does not** send Motor cookies for cross-origin calls to `vehapiproxi`; the proxy owns the Motor session.

**Important:** For article routes, the browser may send **`Authorization: Bearer <supabase_jwt>`**. The proxy **strips** `Authorization` before forwarding to Motor so Supabase tokens are never sent upstream.

### 4.2 End-user Supabase JWT (`Bearer`)

Used for **Torque user identity** and **credits / unlocks**. Verified by calling Supabase **`/auth/v1/user`** with the access token (see `secureAuthMiddleware` in `function.js`).

**Send:** `Authorization: Bearer <supabase_access_token>`

**Typical uses:**

| Area | Auth |
|------|------|
| **`/api/credits/*`** (except webhook) | Required — `secureAuthMiddleware` |
| **`GET .../article/:id/metadata`** | Required |
| **`GET /api/source/.../vehicle/.../article/...` (and `/html`)** | Required by **`articleAccessMiddleware`** — unlock check before cache/upstream |

**Do not** rely on `x-user-id`; it is rejected.

---

## 5. First-party HTTP routes (implemented in `vehapiproxi/src/routes/*`)

These are handled **before** the catch-all proxy (exact behavior is in source; this is a consumer-oriented summary).

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/health` | None | Proxy + Motor session validity snapshot |
| GET | `/auth/status` | None | Poll Motor auth progress (`sessionValid`, etc.) |
| POST | `/auth/start` | None | Kick off Motor authentication (background) |
| GET | `/docs` | None | Swagger UI (if enabled) |
| GET | `/debug/logs`, `/debug/logs/:id`, `/debug/stats` | `x-debug-key` | Requires `DEBUG_API_KEY` server config |
| POST | `/debug/clear` | `x-debug-key` | |
| GET | `/debug/motor-curl`, `/debug/motor-fetch` | `x-debug-key` | Diagnostics |
| GET | `/api/year/:year/make/:make/models` | Motor middleware | Resolves numeric make id → name when needed, then upstream |
| GET | `/api/motor/year/:year/make/:make/models` | Motor middleware | Variant path |
| GET | `/api/source/:source/vehicle/:vehicleId/article/:articleId/orientations` | Motor middleware | Orientation picker data |
| GET | `/api/credits/balance` | Bearer | |
| POST | `/api/credits/checkout` | Bearer | Body: `{ amount, origin? }` — min credits per server rules |
| POST | `/api/credits/portal` | Bearer | Stripe billing portal URL |
| POST | `/api/credits/unlock` | Bearer | Module / feature unlock |
| GET | `/api/credits/transactions` | Bearer | `?limit=` |
| POST | `/api/credits/verify-session` | Bearer | Post–Stripe return: `{ sessionId }` |
| POST | `/api/credits/webhook` | Stripe signature | **Raw JSON body** — not `express.json()` |
| GET | `/api/source/:source/vehicle/:vehicleId/article/:articleId/metadata` | Bearer | `bucket`, `parent_bucket`, `moduleType` from Supabase |
| POST | `/api/rewrite` | None* | Body: `{ html, title? }` — AI; 503 if no API key |
| POST | `/api/tutorials/generate` | None* | Body: `{ html, title? }` |
| POST | `/api/common-issues/generate` | None* | Body: `{ vehicleMetadata: { vehicleName } }` |

\*AI routes may be rate-limited or protected in deployment; treat as internal/service unless you expose them.

---

## 6. Proxied Motor API (`/api/...` and other paths)

Any request that is not satisfied by the handlers above (after `/api` middleware chain) is forwarded to **`config.motorApiBase`** (typically `https://sites.motor.com/m1`) with path rewrite (`/v1` stripped, Chek-Chart legacy rewrites).

**Response shape:** Upstream JSON usually follows **`{ header, body }`** — see `IMPLEMENTATION_GUIDE.md` and `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md`.

**Middleware on `/api` (order matters):**

1. **Article access** — enforces Bearer + unlock for **`/source/.../vehicle/.../article/...`** and **`.../html`**.
2. **Metadata cache** — optional Supabase short-circuit for years/makes/models/engines.
3. **Articles catalog cache** — optional cache for `articles/v2` lists.
4. **Article content cache** — optional cache for the **exact** article content path (not arbitrary sub-routes).

Then the request continues to the proxy.

---

## 7. Frontend consumption guidelines (Torque)

1. **Default:** use **`HttpClient`** with your environment **`apiUrl`** (`/api` in dev).
2. **`withCredentials: true`** only where you rely on **cookies** to the proxy (rare for Supabase JWT flows); credentialed CORS requires an allowed origin.
3. **Attach `Authorization: Bearer`** only for:
   - `/api/credits/*`
   - `/api/source/*/vehicle/*/article/*/metadata`
   - Article content URLs that require unlock (see app interceptor rules in `src/` — avoid attaching Bearer to catalog/year/make/model calls to prevent Motor 401s).
4. **Do not** call Motor domains from the browser for API data.

---

## 8. Related files

| File | Purpose |
|------|---------|
| `vehapiproxi/src/function.js` | App assembly, CORS, auth middleware, proxy, `/api` middleware chain |
| `vehapiproxi/src/routes/*.js` | First-party routes |
| `vehapiproxi/src/swagger.json` | OpenAPI document (also served by `/docs`) |
| `vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md` | M1/upstream semantics (reference for proxy authors) |
| `documentation/IMPLEMENTATION_GUIDE.md` | Algorithms, checklist §23 |
| `AGENTS.md` | Monorepo overview |
