-- =============================================================================
-- L1: procedure_step — one row per repair procedure step (dual-written from AI
--      parse after `procedures` upsert). Replaces all steps for an article on
--      each successful re-parse (worker deletes then inserts).
-- Additive; safe on existing Supabase projects.
-- See docs/plans/2026-03-18-normalization-schema-design.md §3.5
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.procedure_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles (external_id) ON DELETE CASCADE,
    source_article_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    display_order INTEGER,
    step_text TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    warning TEXT,
    note TEXT,
    extractor_version TEXT DEFAULT 'l1-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (vehicle_id, source_article_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_procedure_step_vehicle ON public.procedure_step (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_procedure_step_article ON public.procedure_step (vehicle_id, source_article_id);

ALTER TABLE public.procedure_step ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all procedure_step" ON public.procedure_step;
CREATE POLICY "Allow all procedure_step" ON public.procedure_step FOR ALL USING (true) WITH CHECK (true);
