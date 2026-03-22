-- =============================================================================
-- L1: spec_fact — technician-truth spec rows (dual-written from AI parse)
-- Additive; safe on existing Supabase projects. Run after phase-1 migration.
-- See docs/plans/2026-03-18-normalization-schema-design.md §3.5
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.spec_fact (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id TEXT NOT NULL REFERENCES public.vehicles (external_id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    spec_type TEXT NOT NULL DEFAULT 'other',
    component TEXT,
    value_num NUMERIC,
    value_text TEXT,
    unit TEXT,
    display_text TEXT,
    conditions JSONB,
    confidence REAL DEFAULT 1,
    source_article_id TEXT,
    metadata JSONB,
    extractor_version TEXT DEFAULT 'l1-v1',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (vehicle_id, category, name)
);

CREATE INDEX IF NOT EXISTS idx_spec_fact_vehicle ON public.spec_fact (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_spec_fact_vehicle_type ON public.spec_fact (vehicle_id, spec_type);

ALTER TABLE public.spec_fact ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all spec_fact" ON public.spec_fact;
CREATE POLICY "Allow all spec_fact" ON public.spec_fact FOR ALL USING (true) WITH CHECK (true);
