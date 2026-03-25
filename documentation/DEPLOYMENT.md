# Deployment Guide

This Angular application can be deployed to various platforms. Here are the recommended options:

## 🚀 Quick Deploy Options

### 1. **Vercel** (Recommended - Easiest)
1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repository
4. Vercel will auto-detect Angular and use the `vercel.json` config
5. Deploy!

**Pros:** Zero config, automatic HTTPS, global CDN, preview deployments

---

### 2. **Netlify**
1. Push your code to GitHub
2. Go to [netlify.com](https://netlify.com)
3. Import your repository
4. Netlify will use the `netlify.toml` config
5. Deploy!

**Pros:** Easy setup, form handling, serverless functions support

---

### 3. **GitHub Pages** (Free)
1. Push your code to GitHub
2. Go to repository Settings → Pages
3. Select source: "GitHub Actions"
4. The workflow in `.github/workflows/deploy.yml` will auto-deploy on push to `main`

**Pros:** Free, integrated with GitHub, automatic deployments

**Note:** Update `angular.json` to set `baseHref` if deploying to a subdirectory:
```json
"baseHref": "/your-repo-name/"
```

---

### 4. **Firebase Hosting**
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login: `firebase login`
3. Initialize: `firebase init hosting`
4. Build: `npm run build`
5. Deploy: `firebase deploy`

**Pros:** Google infrastructure, fast CDN, easy rollbacks

---

### 5. **Cloudflare Pages**
1. Push your code to GitHub
2. Go to [pages.cloudflare.com](https://pages.cloudflare.com)
3. Connect repository
4. Build settings:
   - Build command: `npm run build`
   - Build output: `dist`
5. Deploy!

**Pros:** Free, fast, unlimited bandwidth

---

## 📋 Manual Build Steps

Before deploying anywhere, test locally:

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Preview production build locally
npm run preview
```

The built files will be in `dist/`

---

## 🔧 Environment Variables

If you need to configure the API base URL, keep browser traffic pointed at the same deployed app:

1. Create `src/environments/environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  apiUrl: '/api'
};
```

2. Only use an absolute URL when you are intentionally deploying the SPA and proxy on different origins and have updated CORS allowlists accordingly.

### Vercel: AI rewrite / Nemotron (`NVIDIA_API_KEY` / `LLM_API_KEY`)

The production app calls same-origin `/api/*` (see root `vercel.json` → `api/index.js`). **Committing or uploading a `.env` file does not configure Vercel** unless you also define variables in the Vercel project (or use `vercel env push` from the CLI).

1. **Vercel** → your project → **Settings** → **Environment Variables**
2. Add **`NVIDIA_API_KEY`** or **`LLM_API_KEY`** (exact names; optional alias **`NVAPI_KEY`**). Enable for **Production** (and **Preview** if you test preview URLs).
3. **Redeploy** after any env change (Deployments → ⋮ → **Redeploy**). Serverless functions only see new variables on a new deployment.
4. If you use **two** Vercel projects (SPA + backend from `deploy-backend.yml`), set the same LLM keys on the project that actually serves `/api` for the hostname you use in the browser.

**Sanity check:** `POST /api/rewrite` with `{ "html": "<p>test</p>" }` — with a valid key you should get `200` and rewritten HTML; `503` with `code: "MISSING_LLM_KEY"` means the key is not in the function environment; `code: "AI_MODULE_LOAD_FAILED"` means `vehapiproxi` failed to load `ai_parser` (check Vercel function logs).

**Which Vercel project actually runs `/api`?** The browser uses same-origin `/api` (`environment.prod.ts` → `apiUrl: '/api'`). That hits the **Vercel project** deployed by **`.github/workflows/deploy.yml`** (`VERCEL_PROJECT_ID` GitHub secret), not necessarily the separate backend project in **`deploy-backend.yml`** (hardcoded `vercel-project-id`). If you set `NVIDIA_API_KEY` only on the “vehapiproxi” project but production traffic goes to the “vehapi” project (or vice versa), `/api` will not see those variables. **Quick check:** open `GET /health` on your production origin (e.g. `https://<your-app>.vercel.app/health`). The JSON includes **`llmKeyConfigured`** and **`llmKeyEnv`** (name of the variable found, never the value). If `llmKeyConfigured` is `false`, add the key to **that** deployment’s project and redeploy.

---

## 🌐 Custom Domain

All platforms above support custom domains:
- **Vercel/Netlify:** Add domain in dashboard, update DNS
- **GitHub Pages:** Add CNAME file in repository
- **Firebase:** `firebase hosting:channel:deploy production --only hosting`

---

## Observability (vehapiproxi / Vercel)

- **Runtime logs:** Vercel captures stdout/stderr from the Node serverless function. Winston is configured for JSON-friendly structured fields (`vehapiproxi/src/logger.js`).
- **Correlation:** Each request gets a `correlationId` (from `x-request-id` / `x-correlation-id` when sent, otherwise generated). Error responses may include `correlationId` for support triage.
- **Log drains / APM:** In the Vercel project → **Settings → Log Drains**, connect Datadog, Axiom, or another provider to ship JSON logs. Alternatively, poll the Vercel Observability UI for 5xx spikes after deploys.
- **Alerts:** Configure alerts on the log drain or Vercel monitoring for elevated 5xx rates and failed Stripe webhook fulfillment (logged as `Stripe webhook fulfillment failed`).

## GitHub Actions and Vercel deploy verification

Torque uses **two** workflows that deploy to Vercel. After pushing to `main`, confirm the right job(s) succeeded so **vehapiproxi** is not left stale.

| Workflow | File | When it runs | What it deploys |
|----------|------|----------------|-----------------|
| **Deploy to Vercel** | `.github/workflows/deploy.yml` | Every push to `main` | Vercel project from **`VERCEL_PROJECT_ID`** (GitHub secret). Ships the SPA `dist/` and, via `vercel.json`, the serverless entry at `api/index.js` (bundles `vehapiproxi/src/**`). |
| **Deploy Backend (vehapiproxi)** | `.github/workflows/deploy-backend.yml` | Push to `main` **only** when `vehapiproxi/**`, `api/**`, or `vercel.json` changes | Dedicated **backend** Vercel project (`vercel-project-id` is set in that workflow file). Same build gate (`npm run verify:prod-readiness`), then deploy. |

**Required GitHub secrets (both workflows):** `VERCEL_TOKEN`, `VERCEL_ORG_ID`. The main workflow also needs **`VERCEL_PROJECT_ID`** for the primary project.

**After a vehapiproxi-only change:** Open **GitHub → Actions** and confirm **both** runs if your process pushes frontend-only changes in the same commit; otherwise confirm **Deploy Backend (vehapiproxi)** completed green. In **Vercel**, confirm the **backend** project received a new production deployment and that **project environment variables** match what you need (e.g. `MOTOR_INFORMATION_*`, `SUPABASE_*`, Stripe, Nemotron).

**Quick check:** `GET /health` on the deployed API host (or same-origin `/health` from the SPA origin, with `vercel.json` rewriting `/health` → `api/index.js`).

## Release Runtime Parity

- CI should run on **Node 22** to match the root and `vehapiproxi` package engine requirements.
- Before deploy, run `npm run verify:prod-readiness` from repo root. This performs the production Angular build and syntax-checks the critical proxy modules used in release.
- For DB-backed release validation, apply the documented Supabase migrations first, then run the manual checks in [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md).

---

## 📝 Notes

- The app uses hash routing (`#`), so all routes work with static hosting
- No server-side rendering needed
- All platforms support automatic deployments from Git pushes

