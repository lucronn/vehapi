# RLS staging notes (`20260321_rls_staging_tightening.sql`)

## Intent

Drop **“Allow all”** policies on tables that the **browser never queries** with the anon key. The Torque SPA reads **`vehicles`** and **`articles`** (and related catalog data) via Supabase client; it does **not** read `evidence_*`, `content_chunk`, `ai_processing_logs`, etc. Those are accessed only through **vehapiproxi** using the **service role**, which **bypasses RLS**.

## Before apply

1. Confirm in staging (Supabase SQL editor or `pg_policies`) that no Edge Function or third-party client relies on anon/authenticated REST to those tables.
2. Keep a backup or note current policy definitions (rollback SQL is in the migration file header).

## After apply

1. Run worker smoke: `cd vehapiproxi && npm run verify:evidence-links -- --local` (or staging proxy + token).
2. Open the app: vehicle dashboard, article list, unlock flow.
3. If anything breaks, run the rollback snippet in the migration file to restore `Allow all …` policies.

## Related

- `documentation/migrations/20260321_match_content_chunks_rpc.sql` — L2 RPC; executable only by `service_role`.
