# Normalization monitor TUI

Terminal UI to **watch Supabase row counts** for a vehicle during normalization and to **trigger** the same flows as the Node tooling (catalog sync, one-per-bucket test).

## Setup

```bash
# From repo root
pip install -r tools/normalization_tui/requirements.txt
```

Environment (same as `vehapiproxi` — load `vehapiproxi/.env` automatically):

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | PostgREST base |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for row counts |
| `SYNC_AUTH_BEARER` | Optional JWT for catalog sync if your proxy requires auth |

Optional overrides: `NORM_PROXY_URL` / `SYNC_BASE_URL` (default `http://localhost:3001`), `VEHICLE_ID`, `CONTENT_SOURCE`.

## Run

1. Start **vehapiproxi** (`cd vehapiproxi && npm start`) so **Motor** session exists and the background worker can run.
2. From repo root:

```bash
python tools/normalization_tui/app.py
```

## UI

- Edit **vehicle id**, **content source**, and **proxy URL** at the top.
- **Refresh stats** — PostgREST counts (`articles`, `procedures`, `dtcs`, `tsbs`, `specifications`, `maintenance_*`, `parts`, `content_item`) plus `vehicles.is_normalized`.
- **Proxy health** — `GET /health`.
- **Catalog sync** — `GET …/articles/v2?torqueCatalogSync=1` (same as `npm run sync:catalog`).
- **One-per-bucket test** — runs `vehapiproxi/scripts/test-normalization-one-per-category.js` (**wipes** that vehicle’s rows first — confirm dialog).
- **Auto-refresh** — toggles 5s polling (`m`).

Keys: `q` quit, `r` refresh, `h` health, `s` sync, `t` test, `m` monitor toggle.

**Enter** in vehicle / content source / proxy fields runs a **stats refresh** (so you are not stuck if focus landed on the table). The stats table and log are **non-focusable** so Tab cycles the top inputs and action buttons.

## Scope

This tool **does not** reimplement normalization — it **observes** Supabase and **calls** existing proxy/scripts. Heavy parsing still happens inside **Node** (`background_worker.js`).
