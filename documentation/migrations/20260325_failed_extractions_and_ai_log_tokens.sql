-- =============================================================================
-- AI parser hardening: token columns on ai_processing_logs + failed_extractions DLQ
-- Additive; safe on existing Supabase projects.
-- =============================================================================

ALTER TABLE public.ai_processing_logs
    ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS completion_tokens INTEGER;

CREATE TABLE IF NOT EXISTS public.failed_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id TEXT NOT NULL,
    raw_text TEXT,
    error_message TEXT NOT NULL,
    url_path TEXT,
    category TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_failed_extractions_article ON public.failed_extractions (article_id);
CREATE INDEX IF NOT EXISTS idx_failed_extractions_created ON public.failed_extractions (created_at DESC);

ALTER TABLE public.failed_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all failed_extractions" ON public.failed_extractions;
CREATE POLICY "Allow all failed_extractions" ON public.failed_extractions FOR ALL USING (true) WITH CHECK (true);
