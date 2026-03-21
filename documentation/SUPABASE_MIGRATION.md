# Supabase schema migration

The vehicle data pipeline uses Supabase for normalized content (articles, procedures, DTCs, TSBs, specifications, etc.). The schema in **`supabase_schema.sql`** (repo root) is aligned with the pipeline (`vehapiproxi`, `data-sync`, `vehicle-data.service`) and the contract in `src/models/normalized_schema.ts`; see `.cursor/skills/vehicle-data-normalization-migration/SKILL.md` for the full checklist and artifacts.

## Phase 1 normalization (additive — existing projects)

Adds **`canonical_bucket`**, **`evidence_ingest`**, **`evidence_link`**, **`bucket_alias`**, **`content_item`** without dropping legacy tables.

1. Set `SUPABASE_DB_URL` (or `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`) as for the full migration.
2. From `vehapiproxi`: **`npm run migrate:phase1`**  
   (runs `documentation/migrations/20260319_phase1_normalization.sql`).

The background worker dual-writes **`content_item`** next to **`articles`** when this schema is present; if the table is missing, it logs a warning and continues.

## L1 `spec_fact` (additive — after phase 1)

Adds **`spec_fact`** for technician-truth spec rows (dual-written from AI-parsed specifications). Run on projects that already applied phase 1.

1. Same DB URL env as phase 1.
2. From `vehapiproxi`: **`npm run migrate:l1-spec-fact`**  
   (runs `documentation/migrations/20260320_l1_spec_fact.sql`).

If `spec_fact` is missing, the worker logs a warning and continues; legacy **`specifications`** upserts are unchanged.

## L1 `maintenance_task` (additive — after phase 1)

Adds **`maintenance_task`** for L1 maintenance rows, dual-written from the Angular app whenever **`maintenance_schedules`** upserts succeed (`DataSyncService` — mile intervals + F/N/R frequency).

1. Same DB URL env as phase 1.
2. From `vehapiproxi`: **`npm run migrate:l1-maintenance-task`**  
   (runs `documentation/migrations/20260321_l1_maintenance_task.sql`).

If the table is missing, sync logs a short console warning and legacy **`maintenance_schedules`** behavior is unchanged.

## L1 `procedure_step` (additive — after phase 1)

Adds **`procedure_step`** — one row per repair step, written by the **proxy background worker** after each successful **`procedures`** upsert (delete prior steps for that article, then insert; **`evidence_link`** rows use `entity_type=procedure_step` when L0 evidence exists).

1. Same DB URL env as phase 1.
2. From `vehapiproxi`: **`npm run migrate:l1-procedure-step`**  
   (runs `documentation/migrations/20260322_l1_procedure_step.sql`).

## L1 `procedure_tool` + `procedure_part` (additive — after phase 1)

Adds **`procedure_tool`** (string lines from `tools_required`) and **`procedure_part`** (structured rows from `parts_required`). The worker deletes prior rows per article then inserts; **`evidence_link`** uses `entity_type` `procedure_tool` / `procedure_part` when L0 evidence exists.

1. Same DB URL env as phase 1.
2. From `vehapiproxi`: **`npm run migrate:l1-procedure-tool-part`**  
   (runs `documentation/migrations/20260323_l1_procedure_tool_and_part.sql`).

## L2 `content_chunk` + `media_asset` + pgvector (additive — after phase 1)

Adds **`media_asset`** (minimal blob metadata), **`content_chunk`** (text + `vector(1024)` + FK to `content_item` and optional `media_asset`), **`CREATE EXTENSION vector`**, HNSW index on `embedding`, and permissive RLS. Requires Supabase **pgvector** (standard on hosted projects).

1. Same DB URL env as phase 1 (`SUPABASE_DB_URL` or `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`).
2. From `vehapiproxi`: **`npm run migrate:l2-content-chunk`**  
   (runs `documentation/migrations/20260324_l2_content_chunk_pgvector.sql`).

Embedding dimension **1024** must match the model you use when inserting rows; change the migration and `supabase_schema.sql` if you standardize on another size.

**Background worker (optional):** set `ENABLE_L2_EMBEDDINGS=true` and `EMBEDDING_MODEL` in `vehapiproxi/.env` (same NVIDIA key as chat). After each successful article parse, the worker chunks Markdown (from article HTML when present), calls the embeddings API, deletes prior `content_chunk` rows for that `content_item`, and inserts new rows. Tune `L2_EMBEDDING_DIMS` to match your model output.

## AI parser hardening — `failed_extractions` + token columns (additive)

Adds **`prompt_tokens`** and **`completion_tokens`** to **`ai_processing_logs`** (alongside existing **`tokens_used`** total), and **`failed_extractions`** (DLQ when procedure JSON fails Zod validation after self-correction retries).

1. Same DB URL env as other additive migrations.
2. From `vehapiproxi`: **`npm run migrate:ai-hardening`**  
   (runs `documentation/migrations/20260325_failed_extractions_and_ai_log_tokens.sql`).

If token columns are missing, `logAiProcessing` automatically retries the insert without `prompt_tokens` / `completion_tokens` so logs still work until you migrate.

---

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
| `content_item` | `vehicle_external_id, motor_article_id, content_source` | Unified catalog (phase 1; dual-write with `articles`) |
| `evidence_ingest` | (append-only) | L0 API/catalog capture metadata + `sha256` |

## Test: one article per category

To verify the pipeline without flooding the API, run the normalization test (one article per bucket only):

```bash
# From repo root; proxy must be running (e.g. npm run dev in vehapiproxi)
VEHICLE_ID=2854 node vehapiproxi/scripts/test-normalization-one-per-category.js
```

Or from `vehapiproxi`: `npm run test:normalization` (set `VEHICLE_ID` in `.env`).

The script: (1) clears that vehicle’s data from Supabase, (2) ensures the vehicle row exists, (3) fetches the articles catalog, (4) picks one article per bucket, (5) requests each article’s HTML (proxy enqueues background normalization), (6) waits ~35s, (7) prints row counts per table.

## Test: evidence traceability for one article

Verifies the phase-1 links after one article parse: `content_item` enrichment + `evidence_ingest` + `evidence_link`.

By default the script calls the **production** API on **`https://vehapiproxi.vercel.app`** (no local proxy needed). You can still point at a local dev server with `PROXY_URL=http://localhost:3000` or `--proxy=http://localhost:3000`.

**Content source (`--source` / `CONTENT_SOURCE`):** Defaults to `MOTOR`. If the article response is the M1 **SPA shell** (wrong shard—common for GM when `MOTOR` is used), the script **auto-tries** other shards (`GeneralMotors`, `Ford`, …) until it gets real article HTML/JSON, then logs `Auto-switched CONTENT_SOURCE to …`. You can still set `--source=GeneralMotors` explicitly when you already know the catalog (e.g. from `GET …/models`).

```bash
# From vehapiproxi, Supabase env configured (same project the deployed proxy uses).
# Prefer CLI flags: `npm run` often does not forward `VAR=value` into the Node script.
# For GM-heavy vehicles, --source=GeneralMotors avoids an extra probe round-trip.
npm run verify:evidence-links -- --vehicle=2854 --source=GeneralMotors

# Optional: pin a specific article
npm run verify:evidence-links -- --vehicle=2854 --article=123456

# If article HTML is auth-gated on deployed proxy, provide a user bearer token:
npm run verify:evidence-links -- --vehicle=2854 --source=GeneralMotors --token=<supabase_access_token>

# Local proxy instead of Vercel
npm run verify:evidence-links -- --vehicle=2854 --proxy=http://localhost:3000

# Alternatives if your shell forwards env correctly:
export VEHICLE_ID=2854 CONTENT_SOURCE=MOTOR && npm run verify:evidence-links
env VEHICLE_ID=2854 npm run verify:evidence-links

# Or call node directly (env prefix always applies to node):
VEHICLE_ID=2854 node scripts/verify-evidence-links-one-article.js
```

## Vercel deployment (proxy)

When deploying the proxy to Vercel (from repo root, with rewrites to `/api/index.js`):

- Set **Environment variables** in the Vercel project: `NVIDIA_API_KEY` (for all AI: parsing, rewrite, tutorials, common-issues), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and any other vars from `vehapiproxi/.env.example`.
- AI is **Nemotron (NVIDIA)** only; do not set `GEMINI_API_KEY`.
