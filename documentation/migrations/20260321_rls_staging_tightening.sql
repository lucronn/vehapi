-- =============================================================================
-- RLS tightening — server-only normalization / L2 / evidence tables
-- Apply on STAGING first; verify Angular + worker + verify:evidence-links.
--
-- ROLLBACK (restore MVP permissive policies — same as supabase_schema.sql):
--   DROP POLICY IF EXISTS "deny_direct_client_evidence_ingest" ON public.evidence_ingest;
--   (repeat per table) … then:
--   CREATE POLICY "Allow all evidence_ingest" ON public.evidence_ingest FOR ALL USING (true) WITH CHECK (true);
--   (repeat for each table below)
-- =============================================================================

-- Browser uses Supabase anon JWT for vehicles/articles only (see vehicle-data.service).
-- These tables are touched only via vehapiproxi (service role bypasses RLS).
-- Removing broad FOR ALL policies blocks anon/authenticated direct REST access.

DROP POLICY IF EXISTS "Allow all evidence_ingest" ON public.evidence_ingest;
DROP POLICY IF EXISTS "Allow all evidence_link" ON public.evidence_link;
DROP POLICY IF EXISTS "Allow all ai_processing_logs" ON public.ai_processing_logs;
DROP POLICY IF EXISTS "Allow all failed_extractions" ON public.failed_extractions;
DROP POLICY IF EXISTS "Allow all common_issues_cache" ON public.common_issues_cache;
DROP POLICY IF EXISTS "Allow all content_chunk" ON public.content_chunk;
DROP POLICY IF EXISTS "Allow all media_asset" ON public.media_asset;

-- No replacement policies: default deny for non–service-role roles.
-- service_role continues to bypass RLS for backend writes/reads.
