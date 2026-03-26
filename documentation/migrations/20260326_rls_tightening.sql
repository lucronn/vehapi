-- =============================================================================
-- RLS tightening — vehicle/article catalog vs internal ops tables (2026-03-26)
-- =============================================================================
--
-- Security model (direct Supabase REST / PostgREST with anon or authenticated JWT):
--
--   • Group A — Public vehicle/catalog data: SELECT only for anon + authenticated.
--     INSERT/UPDATE/DELETE are denied. The Angular app reads these tables with the
--     anon key; all writes go through vehapiproxi using the service role key.
--
--   • Group B — Internal/ops tables: no policies → default DENY for anon and
--     authenticated. Only the service role (backend/worker) can read/write; it
--     bypasses RLS entirely.
--
--   • vehapiproxi / workers use SUPABASE_SERVICE_ROLE_KEY and are unaffected by
--     these policy changes.
--
--   • Tables such as public.users, public.transactions, and auth.* are not defined
--     in supabase_schema.sql; manage their policies in the same Supabase project
--     via separate migrations if they exist.
--
-- Idempotent: safe to run multiple times (drops old "Allow all …" and replacement
-- "Read-only …" before recreating Group A policies).
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Group A — replace permissive FOR ALL with read-only SELECT
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow all vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Read-only vehicles" ON public.vehicles;
CREATE POLICY "Read-only vehicles" ON public.vehicles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all articles" ON public.articles;
DROP POLICY IF EXISTS "Read-only articles" ON public.articles;
CREATE POLICY "Read-only articles" ON public.articles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all procedures" ON public.procedures;
DROP POLICY IF EXISTS "Read-only procedures" ON public.procedures;
CREATE POLICY "Read-only procedures" ON public.procedures FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all procedure_step" ON public.procedure_step;
DROP POLICY IF EXISTS "Read-only procedure_step" ON public.procedure_step;
CREATE POLICY "Read-only procedure_step" ON public.procedure_step FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all procedure_tool" ON public.procedure_tool;
DROP POLICY IF EXISTS "Read-only procedure_tool" ON public.procedure_tool;
CREATE POLICY "Read-only procedure_tool" ON public.procedure_tool FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all procedure_part" ON public.procedure_part;
DROP POLICY IF EXISTS "Read-only procedure_part" ON public.procedure_part;
CREATE POLICY "Read-only procedure_part" ON public.procedure_part FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all tsbs" ON public.tsbs;
DROP POLICY IF EXISTS "Read-only tsbs" ON public.tsbs;
CREATE POLICY "Read-only tsbs" ON public.tsbs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all dtcs" ON public.dtcs;
DROP POLICY IF EXISTS "Read-only dtcs" ON public.dtcs;
CREATE POLICY "Read-only dtcs" ON public.dtcs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all specifications" ON public.specifications;
DROP POLICY IF EXISTS "Read-only specifications" ON public.specifications;
CREATE POLICY "Read-only specifications" ON public.specifications FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all spec_fact" ON public.spec_fact;
DROP POLICY IF EXISTS "Read-only spec_fact" ON public.spec_fact;
CREATE POLICY "Read-only spec_fact" ON public.spec_fact FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all categories" ON public.categories;
DROP POLICY IF EXISTS "Read-only categories" ON public.categories;
CREATE POLICY "Read-only categories" ON public.categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all vehicle_metadata" ON public.vehicle_metadata;
DROP POLICY IF EXISTS "Read-only vehicle_metadata" ON public.vehicle_metadata;
CREATE POLICY "Read-only vehicle_metadata" ON public.vehicle_metadata FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all parts" ON public.parts;
DROP POLICY IF EXISTS "Read-only parts" ON public.parts;
CREATE POLICY "Read-only parts" ON public.parts FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all maintenance_schedules" ON public.maintenance_schedules;
DROP POLICY IF EXISTS "Read-only maintenance_schedules" ON public.maintenance_schedules;
CREATE POLICY "Read-only maintenance_schedules" ON public.maintenance_schedules FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all maintenance_task" ON public.maintenance_task;
DROP POLICY IF EXISTS "Read-only maintenance_task" ON public.maintenance_task;
CREATE POLICY "Read-only maintenance_task" ON public.maintenance_task FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all canonical_bucket" ON public.canonical_bucket;
DROP POLICY IF EXISTS "Read-only canonical_bucket" ON public.canonical_bucket;
CREATE POLICY "Read-only canonical_bucket" ON public.canonical_bucket FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all bucket_alias" ON public.bucket_alias;
DROP POLICY IF EXISTS "Read-only bucket_alias" ON public.bucket_alias;
CREATE POLICY "Read-only bucket_alias" ON public.bucket_alias FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all common_issues_cache" ON public.common_issues_cache;
DROP POLICY IF EXISTS "Read-only common_issues_cache" ON public.common_issues_cache;
CREATE POLICY "Read-only common_issues_cache" ON public.common_issues_cache FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- Group B — remove permissive policies; no replacement (default deny for clients)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow all ai_processing_logs" ON public.ai_processing_logs;
DROP POLICY IF EXISTS "Allow all failed_extractions" ON public.failed_extractions;
