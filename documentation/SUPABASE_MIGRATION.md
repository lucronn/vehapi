# Supabase schema migration

The vehicle data pipeline uses Supabase for normalized content (articles, procedures, DTCs, TSBs, specifications, etc.). The schema in **`supabase_schema.sql`** (repo root) is aligned with the pipeline (`vehapiproxi`, `data-sync`, `vehicle-data.service`) and the contract in `src/models/normalized_schema.ts`; see `.cursor/skills/vehicle-data-normalization-migration/SKILL.md` for the full checklist and artifacts.

## Option A: Run the migration script (recommended)

From the repo root, with a Postgres connection string set:

1. **Get your database connection URI**  
   - Supabase Dashboard → your project → **Project Settings** → **Database**.  
   - Under **Connection string**, select **URI**.  
   - Copy the URI and replace `[YOUR-PASSWORD]` with your **database password** (this is not the service role key).

2. **Set the env and run**  
   - In `vehapiproxi/.env` (or repo root `.env`), add:
     ```bash
     SUPABASE_DB_URL="postgresql://postgres.xxxx:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
     ```
   - From repo root:
     ```bash
     node vehapiproxi/scripts/run-migrate-schema.js
     ```
   - Or from `vehapiproxi`: `npm run migrate:schema`

The script reads `supabase_schema.sql` from the repo root and executes it against your project.

## Option B: Supabase Dashboard SQL Editor

1. **Supabase Dashboard**  
   - Open your project → **SQL Editor**.  
   - Paste the contents of **`supabase_schema.sql`** (repo root).  
   - Run the script.

2. **What it does**  
   - **Drops** (in order): `ai_processing_logs`, `vehicle_metadata`, `common_issues_cache`, `maintenance_schedules`, `parts`, `specifications`, `categories`, `dtcs`, `tsbs`, `procedures`, `articles`, `vehicles`.  
   - **Does not drop** (by default): `users`, `transactions`, `system_sessions`. To drop those too, uncomment the optional `DROP TABLE` block at the top of `supabase_schema.sql`.  
   - **Creates** all tables with the correct columns and unique constraints (e.g. `procedures`: `UNIQUE(vehicle_id, external_id)`; `articles`: `UNIQUE(vehicle_id, original_id)`).  
   - Enables RLS and adds permissive policies (tighten for production).

3. **After running**  
   - Proxy and frontend will use the new schema. Procedures upsert uses `vehicle_id,external_id` (see `vehapiproxi/src/supabase.js`).  
   - Re-sync or re-fetch vehicle data to repopulate.

## Key tables and conflict keys

| Table                 | Upsert conflict (proxy/code)     | Purpose                          |
|-----------------------|-----------------------------------|----------------------------------|
| `vehicles`            | `external_id`                    | Vehicle registry; `is_normalized` |
| `articles`           | `vehicle_id, original_id`        | Article list/catalog (section UI)|
| `procedures`         | `vehicle_id, external_id`        | Normalized procedures + cache    |
| `tsbs`               | `vehicle_id, bulletin_number`    | TSBs + content cache            |
| `dtcs`               | `vehicle_id, code`               | DTCs + content cache             |
| `specifications`     | `vehicle_id, category, name`    | Specs/fluids                     |
| `parts`              | `vehicle_id, part_number`        | Parts catalog                   |
| `maintenance_schedules` | `vehicle_id, interval_value, action, item` | Maintenance intervals |

## Test: one article per category

To verify the pipeline without flooding the API, run the normalization test (one article per bucket only):

```bash
# From repo root; proxy must be running (e.g. npm run dev in vehapiproxi)
VEHICLE_ID=2854 node vehapiproxi/scripts/test-normalization-one-per-category.js
```

Or from `vehapiproxi`: `npm run test:normalization` (set `VEHICLE_ID` in `.env`).

The script: (1) clears that vehicle’s data from Supabase, (2) ensures the vehicle row exists, (3) fetches the articles catalog, (4) picks one article per bucket, (5) requests each article’s HTML (proxy enqueues background normalization), (6) waits ~35s, (7) prints row counts per table.

## Vercel deployment (proxy)

When deploying the proxy to Vercel (from repo root, with rewrites to `/api/index.js`):

- Set **Environment variables** in the Vercel project: `NVIDIA_API_KEY` (for all AI: parsing, rewrite, tutorials, common-issues), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and any other vars from `vehapiproxi/.env.example`.
- AI is **Nemotron (NVIDIA)** only; do not set `GEMINI_API_KEY`.
